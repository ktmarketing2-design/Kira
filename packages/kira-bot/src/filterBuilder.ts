import { Bot, InlineKeyboard, Context } from "grammy";
import type { Redis } from "ioredis";
import { apiRequest, ApiError } from "./lib/api.js";

const BUILDER_KEY_TTL_SECONDS = 10 * 60;
const LAUNCHPAD_OPTIONS = ["pumpfun", "letsbonk", "bags", "launchlab", "raydium"] as const;

type Step = "name" | "rugscore" | "liquidity" | "fdv" | "launchpads" | "roster" | "confirm";

interface FilterDraft {
  name?: string;
  minRugScore?: number;
  minLiquidityUsd?: number;
  maxFdvUsd?: number;
  launchpads: string[];
  requireRosterWallet?: boolean;
}

interface BuilderState {
  step: Step;
  draft: FilterDraft;
}

interface SignalFilterSummary {
  id: string;
  name: string;
  active: boolean;
  matches24h: number;
  min_rug_score: number | null;
  min_liquidity_usd: number | null;
  max_fdv_usd: number | null;
  launchpads: string[] | null;
  require_roster_wallet: boolean;
}

function builderKey(userId: number): string {
  return `filterbuilder:${userId}`;
}

async function loadState(redis: Redis, userId: number): Promise<BuilderState | null> {
  const raw = await redis.get(builderKey(userId));
  return raw ? (JSON.parse(raw) as BuilderState) : null;
}

async function saveState(redis: Redis, userId: number, state: BuilderState): Promise<void> {
  await redis.set(builderKey(userId), JSON.stringify(state), "EX", BUILDER_KEY_TTL_SECONDS);
}

async function clearState(redis: Redis, userId: number): Promise<void> {
  await redis.del(builderKey(userId));
}

function summaryText(draft: FilterDraft): string {
  const lines = [`Name: ${draft.name ?? "(unset)"}`];
  lines.push(`Min rug score: ${draft.minRugScore ?? "any"}`);
  lines.push(`Min liquidity: ${draft.minLiquidityUsd != null ? `$${draft.minLiquidityUsd.toLocaleString("en-US")}` : "any"}`);
  lines.push(`Max FDV: ${draft.maxFdvUsd != null ? `$${draft.maxFdvUsd.toLocaleString("en-US")}` : "any"}`);
  lines.push(`Launchpads: ${draft.launchpads.length ? draft.launchpads.join(", ") : "any"}`);
  lines.push(`Requires roster wallet buying: ${draft.requireRosterWallet ? "yes" : "no"}`);
  return lines.join("\n");
}

async function promptRugScore(ctx: Context): Promise<void> {
  const keyboard = new InlineKeyboard().text("Skip", "filterstep:skip");
  await ctx.reply("Minimum rug score (0-100)? Reply with a number, or skip.", { reply_markup: keyboard });
}

async function promptLiquidity(ctx: Context): Promise<void> {
  const keyboard = new InlineKeyboard().text("Skip", "filterstep:skip");
  await ctx.reply("Minimum liquidity in USD? Reply with a number, or skip.", { reply_markup: keyboard });
}

async function promptFdv(ctx: Context): Promise<void> {
  const keyboard = new InlineKeyboard().text("Skip", "filterstep:skip");
  await ctx.reply("Maximum FDV in USD? Reply with a number, or skip.", { reply_markup: keyboard });
}

function launchpadKeyboard(selected: string[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const lp of LAUNCHPAD_OPTIONS) {
    const mark = selected.includes(lp) ? "✅" : "⬜️";
    kb.text(`${mark} ${lp}`, `filterlp:${lp}`).row();
  }
  kb.text("Done", "filterlp:done");
  return kb;
}

async function promptLaunchpads(ctx: Context, selected: string[]): Promise<void> {
  await ctx.reply("Which launchpads? Tap to toggle, then Done. Leave all unchecked for any launchpad.", {
    reply_markup: launchpadKeyboard(selected),
  });
}

async function promptRoster(ctx: Context): Promise<void> {
  const keyboard = new InlineKeyboard().text("Yes", "filterroster:yes").text("No", "filterroster:no");
  await ctx.reply("Only fire when one of your roster wallets is also buying?", { reply_markup: keyboard });
}

async function promptConfirm(ctx: Context, draft: FilterDraft): Promise<void> {
  const keyboard = new InlineKeyboard().text("Create", "filterconfirm:create").text("Cancel", "filterconfirm:cancel");
  await ctx.reply(`This filter would match tokens that are...\n\n${summaryText(draft)}`, { reply_markup: keyboard });
}

async function advance(ctx: Context, redis: Redis, userId: number, state: BuilderState): Promise<void> {
  const order: Step[] = ["name", "rugscore", "liquidity", "fdv", "launchpads", "roster", "confirm"];
  const nextStep = order[order.indexOf(state.step) + 1];
  const next: BuilderState = { step: nextStep, draft: state.draft };
  await saveState(redis, userId, next);

  if (nextStep === "rugscore") await promptRugScore(ctx);
  else if (nextStep === "liquidity") await promptLiquidity(ctx);
  else if (nextStep === "fdv") await promptFdv(ctx);
  else if (nextStep === "launchpads") await promptLaunchpads(ctx, state.draft.launchpads);
  else if (nextStep === "roster") await promptRoster(ctx);
  else if (nextStep === "confirm") await promptConfirm(ctx, state.draft);
}

async function renderFilterList(userId: number): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const result = await apiRequest<{ filters: SignalFilterSummary[] }>(userId, "GET", "/signal-filters");
  if (result.filters.length === 0) {
    return { text: "You have no Signal Filters yet.", keyboard: new InlineKeyboard().text("+ Create Filter", "filter:new") };
  }

  const lines = result.filters.map((f) => {
    const bits: string[] = [];
    if (f.min_rug_score != null) bits.push(`rug≥${f.min_rug_score}`);
    if (f.min_liquidity_usd != null) bits.push(`liq≥$${f.min_liquidity_usd.toLocaleString("en-US")}`);
    if (f.max_fdv_usd != null) bits.push(`fdv≤$${f.max_fdv_usd.toLocaleString("en-US")}`);
    if (f.launchpads?.length) bits.push(f.launchpads.join("/"));
    if (f.require_roster_wallet) bits.push("roster required");
    const criteria = bits.length ? bits.join(", ") : "no criteria set";
    return `${f.active ? "🟢" : "⚪️"} *${f.name}* — ${criteria}\n   ${f.matches24h} match${f.matches24h === 1 ? "" : "es"} in 24h`;
  });

  const keyboard = new InlineKeyboard();
  for (const f of result.filters) {
    keyboard.text(f.active ? `Deactivate "${f.name}"` : `Activate "${f.name}"`, `filtertoggle:${f.id}`).row();
    keyboard.text(`Delete "${f.name}"`, `filterdelete:${f.id}`).row();
  }
  keyboard.text("+ Create Filter", "filter:new");

  return { text: lines.join("\n\n"), keyboard };
}

export function registerFilterCommands(bot: Bot, redis: Redis): void {
  bot.command("filter", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    try {
      const { text, keyboard } = await renderFilterList(userId);
      await ctx.reply(text, { parse_mode: "Markdown", reply_markup: keyboard });
    } catch (err) {
      console.error("[kira-bot:filter] list failed:", err instanceof Error ? err.message : err);
      await ctx.reply("Couldn't load your filters.");
    }
  });

  bot.command("filters", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    try {
      const result = await apiRequest<{ filters: SignalFilterSummary[] }>(userId, "GET", "/signal-filters");
      const active = result.filters.filter((f) => f.active);
      if (active.length === 0) {
        await ctx.reply("No active Signal Filters. Use /filter to create one.");
        return;
      }
      const lines = active.map((f) => `🟢 *${f.name}* — ${f.matches24h} match${f.matches24h === 1 ? "" : "es"} in 24h`);
      await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
    } catch {
      await ctx.reply("Couldn't load your filters.");
    }
  });

  bot.callbackQuery("filter:new", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    await saveState(redis, userId, { step: "name", draft: { launchpads: [] } });
    await ctx.answerCallbackQuery();
    await ctx.reply("What should we call this filter? (e.g. \"Safe Pump.fun gems\")");
  });

  bot.callbackQuery(/^filtertoggle:(.+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    try {
      await apiRequest(userId, "PATCH", `/signal-filters/${ctx.match[1]}/toggle`);
      const { text, keyboard } = await renderFilterList(userId);
      await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: keyboard });
      await ctx.answerCallbackQuery();
    } catch (err) {
      const msg = err instanceof ApiError && err.status === 403 ? "Active filter limit reached for your tier." : "Couldn't toggle that filter.";
      await ctx.answerCallbackQuery({ text: msg, show_alert: true });
    }
  });

  bot.callbackQuery(/^filterdelete:(.+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    try {
      await apiRequest(userId, "DELETE", `/signal-filters/${ctx.match[1]}`);
      const { text, keyboard } = await renderFilterList(userId);
      await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: keyboard });
      await ctx.answerCallbackQuery({ text: "Deleted." });
    } catch {
      await ctx.answerCallbackQuery({ text: "Couldn't delete that filter." });
    }
  });

  bot.callbackQuery("filterstep:skip", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    const state = await loadState(redis, userId);
    if (!state) {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    await advance(ctx, redis, userId, state);
  });

  bot.callbackQuery(/^filterlp:(.+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    const state = await loadState(redis, userId);
    if (!state || state.step !== "launchpads") {
      await ctx.answerCallbackQuery();
      return;
    }

    const value = ctx.match[1];
    if (value === "done") {
      await ctx.answerCallbackQuery();
      await advance(ctx, redis, userId, state);
      return;
    }

    const selected = new Set(state.draft.launchpads);
    if (selected.has(value)) selected.delete(value);
    else selected.add(value);
    const draft = { ...state.draft, launchpads: Array.from(selected) };
    await saveState(redis, userId, { step: "launchpads", draft });
    await ctx.editMessageReplyMarkup({ reply_markup: launchpadKeyboard(draft.launchpads) });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^filterroster:(yes|no)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    const state = await loadState(redis, userId);
    if (!state || state.step !== "roster") {
      await ctx.answerCallbackQuery();
      return;
    }
    const draft = { ...state.draft, requireRosterWallet: ctx.match[1] === "yes" };
    await ctx.answerCallbackQuery();
    await advance(ctx, redis, userId, { step: "roster", draft });
  });

  bot.callbackQuery("filterconfirm:cancel", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    await clearState(redis, userId);
    await ctx.answerCallbackQuery({ text: "Cancelled." });
    await ctx.editMessageText("Filter creation cancelled.");
  });

  bot.callbackQuery("filterconfirm:create", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    const state = await loadState(redis, userId);
    if (!state) {
      await ctx.answerCallbackQuery();
      return;
    }
    try {
      await apiRequest(userId, "POST", "/signal-filters", {
        name: state.draft.name,
        minRugScore: state.draft.minRugScore,
        minLiquidityUsd: state.draft.minLiquidityUsd,
        maxFdvUsd: state.draft.maxFdvUsd,
        launchpads: state.draft.launchpads,
        requireRosterWallet: state.draft.requireRosterWallet ?? false,
      });
      await clearState(redis, userId);
      await ctx.answerCallbackQuery({ text: "Created." });
      await ctx.editMessageText(`Filter "${state.draft.name}" created.`);
    } catch (err) {
      const msg = err instanceof ApiError && err.status === 403 ? "Active filter limit reached for your tier. Upgrade with /upgrade." : "Couldn't create that filter.";
      await ctx.answerCallbackQuery({ text: msg, show_alert: true });
    }
  });

  // Free-text steps (name, rug score, liquidity, fdv). Registered last so it never shadows a
  // recognized /command, only fires when the user has an in-progress filter builder session.
  bot.on("message:text", async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return next();

    const state = await loadState(redis, userId);
    if (!state) return next();

    const text = ctx.message.text.trim();

    if (state.step === "name") {
      if (!text) {
        await ctx.reply("Give it a name, or /filter to cancel.");
        return;
      }
      await advance(ctx, redis, userId, { step: "name", draft: { ...state.draft, name: text } });
      return;
    }

    if (state.step === "rugscore" || state.step === "liquidity" || state.step === "fdv") {
      const value = Number(text);
      if (!Number.isFinite(value) || value < 0) {
        await ctx.reply("That's not a valid number, try again or tap Skip.");
        return;
      }
      const draft = { ...state.draft };
      if (state.step === "rugscore") draft.minRugScore = Math.min(100, value);
      if (state.step === "liquidity") draft.minLiquidityUsd = value;
      if (state.step === "fdv") draft.maxFdvUsd = value;
      await advance(ctx, redis, userId, { step: state.step, draft });
      return;
    }

    return next();
  });
}
