import { Worker } from "bullmq";
import { bullConnection } from "../lib/redis.js";
import { supabase } from "../lib/supabase.js";
import { telegramApi } from "../lib/telegram.js";
import { reserveGeminiBudget, generateText } from "../lib/gemini.js";

const LOOKBACK_HOURS = 24;

interface SmartMoneyEventRow {
  wallet_address: string;
  token_address: string;
  side: "buy" | "sell";
  usd_value: number | null;
  kira_smart_wallets: { label: string } | { label: string }[] | null;
}

/** "Tokens you're watching" has no dedicated feature yet (the token page's Add to Watchlist
 * button is still a disabled stub), so this uses the closest existing proxy: tokens the user's
 * own roster wallets have actually traded recently. Not a literal watchlist, but the same idea
 * — tokens this user already has a reason to care about. */
async function loadWatchedTokens(userId: string): Promise<Set<string>> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: rosterRows } = await supabase.from("kira_roster_wallets").select("address").eq("user_id", userId);
  const addresses = (rosterRows ?? []).map((r) => r.address);
  if (addresses.length === 0) return new Set();

  const { data: events } = await supabase
    .from("kira_wallet_events")
    .select("token_address")
    .in("wallet_address", addresses)
    .gte("block_time", since);

  return new Set((events ?? []).map((e) => e.token_address));
}

function formatEventLine(events: SmartMoneyEventRow[], tokenAddress: string): string {
  const forToken = events.filter((e) => e.token_address === tokenAddress);
  const buys = forToken.filter((e) => e.side === "buy");
  const sells = forToken.filter((e) => e.side === "sell");
  const netUsd = forToken.reduce((sum, e) => sum + (e.side === "buy" ? (e.usd_value ?? 0) : -(e.usd_value ?? 0)), 0);
  const truncated = `${tokenAddress.slice(0, 4)}...${tokenAddress.slice(-4)}`;

  if (buys.length > 0 && sells.length === 0) {
    return `$${truncated} — ${buys.length} smart wallet${buys.length === 1 ? "" : "s"} added +$${Math.abs(netUsd).toFixed(0)}`;
  }
  if (sells.length > 0 && buys.length === 0) {
    return `$${truncated} — ${sells.length} smart wallet${sells.length === 1 ? "" : "s"} exited -$${Math.abs(netUsd).toFixed(0)}`;
  }
  return `$${truncated} — net ${netUsd >= 0 ? "+" : "-"}$${Math.abs(netUsd).toFixed(0)} across ${forToken.length} smart money trades`;
}

async function processSmartMoneyDigest(): Promise<void> {
  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();

  const { data: events, error } = await supabase
    .from("kira_smart_money_events")
    .select("wallet_address, token_address, side, usd_value, kira_smart_wallets(label)")
    .gte("block_time", since);

  if (error) {
    console.error("[kira-workers:smart-money-digest] event load failed:", error.message);
    return;
  }
  if (!events || events.length === 0) return; // nothing happened, skip entirely

  const rows = events as unknown as SmartMoneyEventRow[];
  const allTokens = Array.from(new Set(rows.map((r) => r.token_address)));

  const netFlowTotalUsd = rows.reduce(
    (sum, r) => sum + (r.side === "buy" ? (r.usd_value ?? 0) : -(r.usd_value ?? 0)),
    0,
  );

  const { data: profiles, error: profileError } = await supabase
    .from("kira_profiles")
    .select("id, telegram_user_id")
    .not("telegram_user_id", "is", null);

  if (profileError) {
    console.error("[kira-workers:smart-money-digest] profile load failed:", profileError.message);
    return;
  }

  for (const profile of profiles ?? []) {
    const watchedTokens = await loadWatchedTokens(profile.id);
    const watchedWithActivity = allTokens.filter((t) => watchedTokens.has(t));
    const newEntries = allTokens.filter((t) => !watchedTokens.has(t));

    if (watchedWithActivity.length === 0 && newEntries.length === 0) continue;

    const sections: string[] = [];
    if (watchedWithActivity.length > 0) {
      sections.push("*Tokens you're watching:*");
      sections.push(...watchedWithActivity.slice(0, 5).map((t) => formatEventLine(rows, t)));
    }
    if (newEntries.length > 0) {
      sections.push("");
      sections.push("*New entries (not in your watchlist):*");
      sections.push(...newEntries.slice(0, 5).map((t) => formatEventLine(rows, t)));
    }

    let summary: string | null = null;
    const budgetOk = await reserveGeminiBudget("smart-money-digest", 150);
    if (budgetOk) {
      summary = await generateText(
        `Write one short sentence summarizing today's smart money trading activity based on this data: ` +
          `net flow ${netFlowTotalUsd >= 0 ? "+" : ""}$${netFlowTotalUsd.toFixed(0)} across ${allTokens.length} tokens. ` +
          `No markdown, no disclaimers.`,
      );
    }

    const message = ["🧠 *Smart Money Digest*", new Date().toISOString().slice(0, 10), "", ...sections];
    if (summary) message.push("", summary);

    try {
      await telegramApi.sendMessage(profile.telegram_user_id, message.join("\n"), { parse_mode: "Markdown" });
    } catch (err) {
      console.error(
        "[kira-workers:smart-money-digest] telegram send failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }
}

export function startSmartMoneyDigestWorker(): Worker {
  return new Worker("kira-smart-money-digest", processSmartMoneyDigest, { connection: bullConnection, concurrency: 1 });
}
