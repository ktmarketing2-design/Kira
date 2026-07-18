// =============================================================================
// kira-bot (grammY, long polling)
// =============================================================================
// Thin Telegram client over kira-api. Never calls external data APIs or Supabase
// directly, everything goes through kira-api's internal bot-token auth path.
// Owned by Claude Code per the Kira Sprint 1-2 build spec.
// =============================================================================

import { Bot, InlineKeyboard, GrammyError, HttpError, type Context } from "grammy";
import { Redis } from "ioredis";
import { apiRequest, telegramStart, telegramLinkCode, telegramLinkEmail, ApiError } from "./lib/api.js";
import { escapeMarkdownV2, formatDdCard, truncateAddress } from "./lib/format.js";
import { registerFilterCommands } from "./filterBuilder.js";
import { getBuyBots } from "./config/buyBots.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN must be set in the environment");
}

const redis = new Redis({
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: Number(process.env.REDIS_PORT || 6379),
});

const bot = new Bot(token);

const RATE_LIMIT_PER_MINUTE = 10;

bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId) {
    await next();
    return;
  }

  const minuteBucket = Math.floor(Date.now() / 60_000);
  const key = `botrl:${userId}:${minuteBucket}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 65);

  if (count > RATE_LIMIT_PER_MINUTE) {
    await ctx.reply("You're sending commands too fast, please wait a minute and try again.");
    return;
  }

  await next();
});

const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function isLikelyAddress(input: string): boolean {
  return SOLANA_ADDRESS_RE.test(input);
}

bot.command("start", async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    const result = await telegramStart(userId, ctx.from?.username);

    if (!result.linked) {
      await ctx.reply(
        "👋 Welcome to Kira by Ceronix Labs.\n\n" +
          "To connect your account, click the link below:\n" +
          `https://kira.ceronix.ai/link/${result.code}\n\n` +
          "The link expires in 15 minutes.",
      );
      return;
    }

    await ctx.reply(
      `Welcome back. Tier: ${result.tier ?? "scout"}. Wallets tracked: ${result.walletCount ?? 0}.\n\n` +
        "Commands: /dd /vol /add /remove /roster /alerts /filter /filters /kol /pnl /upgrade",
    );
  } catch (err) {
    console.error("[kira-bot:start] failed:", err instanceof Error ? err.message : err);
    await ctx.reply("Something went wrong starting your session, please try again shortly.");
  }
});

bot.command("dd", async (ctx) => {
  const userId = ctx.from?.id;
  const arg = ctx.match?.trim();
  if (!userId) return;
  if (!arg) {
    await ctx.reply("Usage: /dd <token address>");
    return;
  }
  if (!isLikelyAddress(arg)) {
    await ctx.reply("That doesn't look like a Solana token address. Ticker search isn't supported yet, paste the contract address.");
    return;
  }

  try {
    await ctx.replyWithChatAction("typing");
    const card = await apiRequest<Parameters<typeof formatDdCard>[0]>(userId, "GET", `/token/${arg}/dd`);

    const keyboard = new InlineKeyboard()
      .text("🔄 Refresh", `dd:${arg}`)
      .text("💰 Buy Token", `buy:${arg}`);

    await ctx.reply(formatDdCard(card), { parse_mode: "MarkdownV2", reply_markup: keyboard });
  } catch (err) {
    await replyWithApiError(ctx, err, "Couldn't generate a Deep Dive for that token.");
  }
});

bot.command("vol", async (ctx) => {
  const userId = ctx.from?.id;
  const arg = ctx.match?.trim();
  if (!userId) return;
  if (!arg || !isLikelyAddress(arg)) {
    await ctx.reply("Usage: /vol <token address>");
    return;
  }

  try {
    await ctx.replyWithChatAction("typing");
    const result = await apiRequest<{
      score: number;
      verdict: string;
      signals: Array<{ name: string; flag: boolean; value: number }>;
    }>(userId, "GET", `/token/${arg}/volume`);

    const signalLines = result.signals
      .map((s) => `${s.flag ? "⚠️" : "✅"} ${escapeMarkdownV2(s.name)}`)
      .join("\n");

    await ctx.reply(
      `📊 *Volume Score: ${result.score}/100* \\(${escapeMarkdownV2(result.verdict)}\\)\n\n${signalLines}`,
      { parse_mode: "MarkdownV2" },
    );
  } catch (err) {
    await replyWithApiError(ctx, err, "Couldn't compute a volume score for that token.");
  }
});

bot.command("add", async (ctx) => {
  const userId = ctx.from?.id;
  const parts = ctx.match?.trim().split(/\s+/) ?? [];
  const [address, ...labelParts] = parts;
  if (!userId) return;
  if (!address || !isLikelyAddress(address)) {
    await ctx.reply("Usage: /add <wallet address> [label]");
    return;
  }

  try {
    await apiRequest(userId, "POST", "/roster", { address, label: labelParts.join(" ") || undefined });
    await ctx.reply(`Added ${truncateAddress(address)} to your roster.`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      await ctx.reply("Roster limit reached for your tier. Upgrade with /upgrade to track more wallets.");
      return;
    }
    if (err instanceof ApiError && err.status === 409) {
      await ctx.reply("That wallet is already in your roster.");
      return;
    }
    await replyWithApiError(ctx, err, "Couldn't add that wallet.");
  }
});

bot.command("remove", async (ctx) => {
  const userId = ctx.from?.id;
  const address = ctx.match?.trim();
  if (!userId) return;
  if (!address || !isLikelyAddress(address)) {
    await ctx.reply("Usage: /remove <wallet address>");
    return;
  }

  try {
    await apiRequest(userId, "DELETE", `/roster/${address}`);
    await ctx.reply(`Removed ${truncateAddress(address)} from your roster.`);
  } catch (err) {
    await replyWithApiError(ctx, err, "Couldn't remove that wallet.");
  }
});

bot.command("roster", async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    const result = await apiRequest<{
      wallets: Array<{ address: string; label: string | null; performance7d: { win_rate: number | null } | null }>;
    }>(userId, "GET", "/roster");

    if (result.wallets.length === 0) {
      await ctx.reply("Your roster is empty. Add a wallet with /add <address> [label].");
      return;
    }

    const lines = result.wallets.map((w) => {
      const name = w.label || truncateAddress(w.address);
      const winRate = w.performance7d?.win_rate;
      const perf = winRate != null ? ` (7d win rate ${Math.round(winRate * 100)}%)` : "";
      return `• ${name}${perf}`;
    });

    await ctx.reply(`Your roster (${result.wallets.length}):\n\n${lines.join("\n")}`);
  } catch (err) {
    await replyWithApiError(ctx, err, "Couldn't load your roster.");
  }
});

bot.command("alerts", async (ctx) => {
  const keyboard = new InlineKeyboard()
    .text("Threshold 2+", "alertset:threshold:2")
    .text("Threshold 3+", "alertset:threshold:3")
    .row()
    .text("Window 1h", "alertset:window:60")
    .text("Window 2h", "alertset:window:120")
    .text("Window 4h", "alertset:window:240")
    .text("Window 8h", "alertset:window:480");

  await ctx.reply("Configure your alert threshold and time window:", { reply_markup: keyboard });
});

bot.callbackQuery(/^alertset:(threshold|window):(\d+)$/, async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  const [, kind, valueStr] = ctx.match;
  const value = Number(valueStr);

  try {
    const body = kind === "threshold" ? { clusterThreshold: value } : { windowMinutes: value };
    await apiRequest(userId, "PATCH", "/me/settings", body);
    await ctx.answerCallbackQuery({ text: "Saved." });
  } catch (err) {
    if (err instanceof ApiError) {
      await ctx.answerCallbackQuery({ text: "Your tier doesn't allow that setting.", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery({ text: "Failed to save, try again." });
  }
});

bot.callbackQuery(/^dd:(.+)$/, async (ctx) => {
  const userId = ctx.from?.id;
  const address = ctx.match[1];
  if (!userId) return;

  try {
    const card = await apiRequest<Parameters<typeof formatDdCard>[0]>(userId, "GET", `/token/${address}/dd`);
    const keyboard = new InlineKeyboard()
      .text("🔄 Refresh", `dd:${address}`)
      .text("💰 Buy Token", `buy:${address}`);
    await ctx.editMessageText(formatDdCard(card), { parse_mode: "MarkdownV2", reply_markup: keyboard });
    await ctx.answerCallbackQuery();
  } catch {
    await ctx.answerCallbackQuery({ text: "Refresh failed, try again." });
  }
});

bot.callbackQuery(/^vol:(.+)$/, async (ctx) => {
  const userId = ctx.from?.id;
  const address = ctx.match[1];
  if (!userId) return;

  try {
    const result = await apiRequest<{ score: number; verdict: string }>(userId, "GET", `/token/${address}/volume`);
    await ctx.answerCallbackQuery({
      text: `Volume: ${result.score}/100 (${result.verdict})`,
      show_alert: true,
    });
  } catch {
    await ctx.answerCallbackQuery({ text: "Couldn't fetch volume score." });
  }
});

bot.callbackQuery(/^buy:(.+)$/, async (ctx) => {
  const userId = ctx.from?.id;
  const address = ctx.match[1];
  if (!userId) return;

  try {
    const card = await apiRequest<{ symbol: string | null; graduated: boolean | null }>(
      userId,
      "GET",
      `/token/${address}/dd`,
    );
    const symbol = card.symbol ?? "TOKEN";
    const bots = getBuyBots(card.graduated === true);

    const keyboard = new InlineKeyboard();
    for (const buyBot of bots) {
      const url = buyBot.urlTemplate.replace("{address}", address);
      keyboard.url(buyBot.label, url).row();
    }

    await ctx.reply(`💰 Buy $${symbol}\n\nChoose your preferred trading bot:`, { reply_markup: keyboard });
    await ctx.answerCallbackQuery();
  } catch {
    await ctx.answerCallbackQuery({ text: "Couldn't load buy options, try again." });
  }
});

bot.command("pnl", async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;

  const arg = ctx.match?.trim();
  if (arg?.startsWith("add ")) {
    const address = arg.slice(4).trim();
    if (!isLikelyAddress(address)) {
      await ctx.reply("Usage: /pnl add <wallet address>");
      return;
    }
    try {
      await apiRequest(userId, "POST", "/pnl/wallets", { address });
      await ctx.reply(`Added ${truncateAddress(address)} for PnL tracking. Digests are sent daily at 06:00 UTC.`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        await ctx.reply("PnL wallet limit reached for your tier. Upgrade with /upgrade.");
        return;
      }
      await replyWithApiError(ctx, err, "Couldn't add that wallet.");
    }
    return;
  }

  try {
    const walletsResult = await apiRequest<{ wallets: Array<{ address: string; label: string | null }> }>(
      userId,
      "GET",
      "/pnl/wallets",
    );
    if (walletsResult.wallets.length === 0) {
      await ctx.reply(
        "📊 No PnL wallets configured yet.\n\n" +
          "Add your Solana wallet to track your trading performance:\n" +
          "/pnl add [wallet address]\n\n" +
          "Example:\n" +
          "/pnl add DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
      );
      return;
    }

    const snapshotsResult = await apiRequest<{
      snapshots: Array<{
        wallet_address: string;
        date: string;
        realized_pnl_usd: number | null;
        total_trades: number | null;
        winning_trades: number | null;
        top_gainer_symbol: string | null;
        top_gainer_pct: number | null;
      }>;
    }>(userId, "GET", "/pnl/snapshots");

    if (snapshotsResult.snapshots.length === 0) {
      await ctx.reply("No PnL data yet, check back after tomorrow's 06:00 UTC digest.");
      return;
    }

    const latestByWallet = new Map<string, (typeof snapshotsResult.snapshots)[number]>();
    for (const s of snapshotsResult.snapshots) {
      const existing = latestByWallet.get(s.wallet_address);
      if (!existing || s.date > existing.date) latestByWallet.set(s.wallet_address, s);
    }

    const lines = ["📊 Yesterday's PnL", ""];
    for (const wallet of walletsResult.wallets) {
      const snap = latestByWallet.get(wallet.address);
      if (!snap) continue;
      const label = wallet.label || truncateAddress(wallet.address);
      const pnl = snap.realized_pnl_usd ?? 0;
      lines.push(
        `${label}: ${pnl >= 0 ? "+" : "-"}$${Math.abs(pnl).toFixed(0)} (${snap.total_trades ?? 0} trades, ${snap.winning_trades ?? 0} wins)`,
      );
      if (snap.top_gainer_symbol) {
        lines.push(`Best: ${truncateAddress(snap.top_gainer_symbol)} +${(snap.top_gainer_pct ?? 0).toFixed(0)}%`);
      }
    }
    lines.push("", "Add a wallet: /pnl add [address]");
    await ctx.reply(lines.join("\n"));
  } catch (err) {
    await replyWithApiError(ctx, err, "Couldn't load your PnL data.");
  }
});

bot.command("watchlist", async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;

  const arg = ctx.match?.trim();
  if (arg?.startsWith("add ")) {
    const address = arg.slice(4).trim();
    if (!isLikelyAddress(address)) {
      await ctx.reply("Usage: /watchlist add <token address>");
      return;
    }
    try {
      await apiRequest(userId, "POST", "/watchlist", { tokenAddress: address });
      await ctx.reply(`Added ${truncateAddress(address)} to your watchlist.`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        await ctx.reply("Watchlist limit reached for your tier. Upgrade with /upgrade.");
        return;
      }
      if (err instanceof ApiError && err.status === 409) {
        await ctx.reply("That token is already in your watchlist.");
        return;
      }
      await replyWithApiError(ctx, err, "Couldn't add that token.");
    }
    return;
  }

  if (arg?.startsWith("remove ")) {
    const address = arg.slice(7).trim();
    if (!isLikelyAddress(address)) {
      await ctx.reply("Usage: /watchlist remove <token address>");
      return;
    }
    try {
      await apiRequest(userId, "DELETE", `/watchlist/${address}`);
      await ctx.reply(`Removed ${truncateAddress(address)} from your watchlist.`);
    } catch (err) {
      await replyWithApiError(ctx, err, "Couldn't remove that token.");
    }
    return;
  }

  try {
    const result = await apiRequest<{
      tokens: Array<{ tokenAddress: string; tokenSymbol: string | null; addedAt: string }>;
    }>(userId, "GET", "/watchlist");

    if (result.tokens.length === 0) {
      await ctx.reply(
        "⭐ No tokens saved yet.\n\n" +
          "Add a token to your watchlist:\n" +
          "/watchlist add [token address]\n\n" +
          "Example:\n" +
          "/watchlist add DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
      );
      return;
    }

    const lines = ["⭐ Your Watchlist", ""];
    for (const t of result.tokens) {
      lines.push(`$${t.tokenSymbol ?? truncateAddress(t.tokenAddress)} — ${truncateAddress(t.tokenAddress)}`);
    }
    lines.push("", "Remove a token: /watchlist remove [address]");
    await ctx.reply(lines.join("\n"));
  } catch (err) {
    await replyWithApiError(ctx, err, "Couldn't load your watchlist.");
  }
});

bot.command("ask", async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;

  const arg = ctx.match?.trim() ?? "";
  const spaceIdx = arg.indexOf(" ");
  const tokenAddress = spaceIdx === -1 ? arg : arg.slice(0, spaceIdx);
  const question = spaceIdx === -1 ? "" : arg.slice(spaceIdx + 1).trim();

  if (!tokenAddress || !isLikelyAddress(tokenAddress) || !question) {
    await ctx.reply("Usage: /ask <token address> <question>\n\nExample:\n/ask DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263 when was it launched?");
    return;
  }

  const placeholder = await ctx.reply("🔍 Researching...");

  try {
    const result = await apiRequest<{ answer: string; tokenAddress: string }>(userId, "POST", "/ask", {
      tokenAddress,
      question,
    });

    let symbol = truncateAddress(tokenAddress);
    try {
      const cached = await apiRequest<{ card: { symbol: string | null } | null }>(
        userId,
        "GET",
        `/token/${tokenAddress}/dd-cached`,
      );
      if (cached.card?.symbol) symbol = cached.card.symbol;
    } catch {
      // Non-fatal -- fall back to the truncated address in the header if the cached-DD lookup fails.
    }

    const text = [
      `🔍 $${symbol} — Research`,
      "",
      result.answer,
      "",
      "Data: DD card · KOL calls · Smart money · Your roster",
    ].join("\n");

    await ctx.api.editMessageText(ctx.chat!.id, placeholder.message_id, text);
  } catch (err) {
    const msg =
      err instanceof ApiError && err.status === 403
        ? "Daily /ask limit reached for your tier. Upgrade with /upgrade."
        : "Couldn't research that token right now.";
    await ctx.api.editMessageText(ctx.chat!.id, placeholder.message_id, msg).catch(() => {});
    console.error("[kira-bot:ask] failed:", err instanceof Error ? err.message : err);
  }
});

bot.command("kol", async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  try {
    const result = await apiRequest<{
      sources: Array<{ displayName: string | null; channelIdentifier: string; winRate7d: number | null; totalCalls: number }>;
      warmingUp: boolean;
    }>(userId, "GET", "/kol/sources");

    if (result.warmingUp) {
      await ctx.reply(
        "KOL tracker is warming up.\nHistorical data is being collected from 10 channels.\nCheck back in 24-48 hours for accuracy scores.",
      );
      return;
    }

    const top5 = [...result.sources]
      .filter((s) => s.winRate7d != null)
      .sort((a, b) => (b.winRate7d ?? 0) - (a.winRate7d ?? 0))
      .slice(0, 5);

    if (top5.length === 0) {
      await ctx.reply("No 7d win rate data yet, check back soon.");
      return;
    }

    const lines = top5.map(
      (s, i) => `${i + 1}. ${s.displayName ?? s.channelIdentifier} — ${Math.round((s.winRate7d ?? 0) * 100)}% (${s.totalCalls} calls)`,
    );
    await ctx.reply(`🏆 Top KOL channels (7d win rate)\n\n${lines.join("\n")}`);
  } catch {
    await ctx.reply("Couldn't load KOL stats right now.");
  }
});

registerFilterCommands(bot, redis);

const LINK_CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Sprint 10 Part 4: /link handles two directions with one command, disambiguated by argument
 * shape -- a 6-char code (web Settings "Link Telegram Account" button) or an email address
 * (linking to an existing web account from Telegram).
 */
bot.command("link", async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;

  const arg = ctx.match?.toString().trim();
  if (!arg) {
    await ctx.reply(
      "Usage:\n" +
        "/link CODE -- after clicking \"Link Telegram Account\" in Settings\n" +
        "/link you@email.com -- to link this Telegram account to an existing Kira account",
    );
    return;
  }

  if (LINK_CODE_RE.test(arg)) {
    try {
      await telegramLinkCode(arg.toUpperCase(), userId, ctx.from?.username);
      await ctx.reply("✅ Telegram account linked.");
    } catch (err) {
      const message =
        err instanceof ApiError && err.body && typeof err.body === "object" && "error" in err.body
          ? String((err.body as { error: unknown }).error)
          : "Couldn't link with that code.";
      await ctx.reply(`❌ ${message}`);
    }
    return;
  }

  if (EMAIL_RE.test(arg)) {
    try {
      await telegramLinkEmail(arg, userId, ctx.from?.username);
      await ctx.reply(`📧 Check ${arg} for a verification link to confirm the connection.`);
    } catch (err) {
      const message =
        err instanceof ApiError && err.body && typeof err.body === "object" && "error" in err.body
          ? String((err.body as { error: unknown }).error)
          : "Couldn't start linking with that email.";
      await ctx.reply(`❌ ${message}`);
    }
    return;
  }

  await ctx.reply("That doesn't look like a link code or an email address.");
});

bot.command("upgrade", async (ctx) => {
  await ctx.reply(
    "Scout (free): 5 wallets, 10 Deep Dives/day, threshold locked to 3.\n" +
      "Pro: 50 wallets, unlimited Deep Dives, threshold 2 allowed.\n" +
      "Elite: unlimited everything.\n\n" +
      "Upgrade: https://kira.ceronix.ai/upgrade",
  );
});

async function replyWithApiError(ctx: Context, err: unknown, fallback: string): Promise<void> {
  console.error("[kira-bot] command failed:", err instanceof Error ? err.message : err);
  await ctx.reply(fallback);
}

bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`[kira-bot] error while handling update ${ctx.update.update_id}:`);
  const e = err.error;
  if (e instanceof GrammyError) {
    console.error("Error in request:", e.description);
  } else if (e instanceof HttpError) {
    console.error("Could not contact Telegram:", e);
  } else {
    console.error("Unknown error:", e);
  }
});

await bot.api.setMyCommands([
  { command: "start", description: "Welcome and account setup" },
  { command: "dd", description: "Deep Dive a token: /dd [address]" },
  { command: "vol", description: "Volume score: /vol [address]" },
  { command: "add", description: "Add wallet to roster: /add [address]" },
  { command: "remove", description: "Remove wallet: /remove [address]" },
  { command: "roster", description: "View your tracked wallets" },
  { command: "alerts", description: "Configure alert settings" },
  { command: "filter", description: "Create a signal filter" },
  { command: "filters", description: "View your signal filters" },
  { command: "kol", description: "KOL tracker and personal sources" },
  { command: "pnl", description: "Your PnL digest" },
  { command: "watchlist", description: "Your saved tokens: /watchlist [add|remove] [address]" },
  { command: "ask", description: "Ask about a token: /ask [address] [question]" },
  { command: "upgrade", description: "View plans and upgrade" },
  { command: "link", description: "Link Telegram to your Kira account: /link CODE or /link email" },
]);

await bot.api.setMyDescription(
  "Kira by Ceronix Labs \u2014 On-chain intelligence for Solana traders. Wallet alerts, rug checks, volume authenticity, signal filters, KOL tracking, and smart money digest.",
);

await bot.api.setMyShortDescription(
  "On-chain intel for Solana traders. Wallet alerts, rug checks & signal filters.",
);

bot.start({
  onStart: () => console.log("[kira-bot] long polling started"),
});
