// =============================================================================
// kira-bot (grammY, long polling)
// =============================================================================
// Thin Telegram client over kira-api. Never calls external data APIs or Supabase
// directly, everything goes through kira-api's internal bot-token auth path.
// Owned by Claude Code per the Kira Sprint 1-2 build spec.
// =============================================================================

import { Bot, InlineKeyboard, GrammyError, HttpError, type Context } from "grammy";
import { Redis } from "ioredis";
import { apiRequest, telegramStart, ApiError } from "./lib/api.js";
import { escapeMarkdownV2, formatDdCard, truncateAddress } from "./lib/format.js";
import { registerFilterCommands } from "./filterBuilder.js";

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
      .text("📊 Volume Score", `vol:${arg}`);

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
      .text("📊 Volume Score", `vol:${address}`);
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
      await ctx.reply("No wallets tracked for PnL yet.\n\nAdd a wallet: /pnl add [address]");
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

bot.start({
  onStart: () => console.log("[kira-bot] long polling started"),
});
