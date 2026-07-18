import { Worker } from "bullmq";
import { helius, jupiter, type HeliusConfig } from "@ceronix/kira-shared";
import { bullConnection, redis } from "../lib/redis.js";
import { supabase } from "../lib/supabase.js";
import { telegramApi } from "../lib/telegram.js";
import { reserveGeminiBudget, generateText } from "../lib/gemini.js";

const heliusConfig: HeliusConfig = { apiKey: process.env.HELIUS_API_KEY ?? "" };
const SOL_MINT = "So11111111111111111111111111111111111111112";
const TX_LOOKBACK = 100;

interface Trade {
  tokenAddress: string;
  side: "buy" | "sell";
  tokenAmount: number;
  usdValue: number;
  timestamp: number;
  signature: string;
}

/**
 * Derives buy/sell trades for one wallet since the last processed timestamp, valuing each trade
 * in USD via the SOL amount moved in the same transaction (converted at TODAY's SOL/USD price,
 * not the historical price at trade time, Jupiter's free price API is live-only, no historical
 * quotes). This is a real, documented simplification: PnL here is accurate in SOL terms and only
 * approximate in USD terms for anything but same-day trades. See kira-workers/README.md.
 */
async function deriveTrades(address: string, sinceTs: number, solPriceUsd: number): Promise<Trade[]> {
  const history = await helius.getTransactionHistory(heliusConfig, address, { limit: TX_LOOKBACK });
  const trades: Trade[] = [];

  for (const tx of history) {
    if (tx.timestamp <= sinceTs) continue;

    const solMoved = (tx.nativeTransfers ?? []).reduce((sum, t) => {
      if (t.fromUserAccount === address) return sum - (t.amount ?? 0);
      if (t.toUserAccount === address) return sum + (t.amount ?? 0);
      return sum;
    }, 0);
    const usdValue = Math.abs(solMoved) / 1e9 * solPriceUsd;

    for (const transfer of tx.tokenTransfers ?? []) {
      if (!transfer.mint || transfer.mint === SOL_MINT || !transfer.tokenAmount) continue;

      if (transfer.toUserAccount === address) {
        trades.push({ tokenAddress: transfer.mint, side: "buy", tokenAmount: transfer.tokenAmount, usdValue, timestamp: tx.timestamp, signature: tx.signature });
      } else if (transfer.fromUserAccount === address) {
        trades.push({ tokenAddress: transfer.mint, side: "sell", tokenAmount: transfer.tokenAmount, usdValue, timestamp: tx.timestamp, signature: tx.signature });
      }
    }
  }

  return trades;
}

interface Lot {
  tokenAmount: number;
  unitCostUsd: number;
}

interface WalletPnl {
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  totalTrades: number;
  winningTrades: number;
  topGainerSymbol: string | null;
  topGainerPct: number | null;
  topLoserSymbol: string | null;
  topLoserPct: number | null;
}

/** FIFO-matches today's buys against today's sells per token. Sells with no matching buy lot
 * from today (an older, already-held position) are excluded from realized PnL, we have no cost
 * basis for them without a full historical position reconstruction, out of scope here. */
async function computeWalletPnl(trades: Trade[]): Promise<WalletPnl> {
  const lotsByToken = new Map<string, Lot[]>();
  let realizedPnlUsd = 0;
  let winningTrades = 0;
  let totalTrades = 0;
  let bestPct: { symbol: string; pct: number } | null = null;
  let worstPct: { symbol: string; pct: number } | null = null;

  const byTimestamp = [...trades].sort((a, b) => a.timestamp - b.timestamp);

  for (const trade of byTimestamp) {
    const lots = lotsByToken.get(trade.tokenAddress) ?? [];

    if (trade.side === "buy") {
      const unitCostUsd = trade.tokenAmount > 0 ? trade.usdValue / trade.tokenAmount : 0;
      lots.push({ tokenAmount: trade.tokenAmount, unitCostUsd });
      lotsByToken.set(trade.tokenAddress, lots);
      continue;
    }

    // sell: FIFO consume available lots for this token
    let remaining = trade.tokenAmount;
    const sellUnitPriceUsd = trade.tokenAmount > 0 ? trade.usdValue / trade.tokenAmount : 0;
    let matchedQty = 0;
    let costOfMatched = 0;

    while (remaining > 0 && lots.length > 0) {
      const lot = lots[0];
      const take = Math.min(lot.tokenAmount, remaining);
      matchedQty += take;
      costOfMatched += take * lot.unitCostUsd;
      lot.tokenAmount -= take;
      remaining -= take;
      if (lot.tokenAmount <= 0) lots.shift();
    }
    lotsByToken.set(trade.tokenAddress, lots);

    if (matchedQty > 0) {
      const proceedsOfMatched = matchedQty * sellUnitPriceUsd;
      const pnl = proceedsOfMatched - costOfMatched;
      realizedPnlUsd += pnl;
      totalTrades++;
      if (pnl > 0) winningTrades++;

      const pct = costOfMatched > 0 ? (pnl / costOfMatched) * 100 : 0;
      if (!bestPct || pct > bestPct.pct) bestPct = { symbol: trade.tokenAddress, pct };
      if (!worstPct || pct < worstPct.pct) worstPct = { symbol: trade.tokenAddress, pct };
    }
  }

  // Unrealized: remaining open lots from today, valued at current price.
  let unrealizedPnlUsd = 0;
  for (const [tokenAddress, lots] of lotsByToken) {
    const remainingQty = lots.reduce((sum, l) => sum + l.tokenAmount, 0);
    if (remainingQty <= 0) continue;
    const currentPrice = await jupiter.getPrice(tokenAddress);
    if (currentPrice == null) continue;
    const costBasis = lots.reduce((sum, l) => sum + l.tokenAmount * l.unitCostUsd, 0);
    unrealizedPnlUsd += remainingQty * currentPrice - costBasis;
  }

  return {
    realizedPnlUsd,
    unrealizedPnlUsd,
    totalTrades,
    winningTrades,
    topGainerSymbol: bestPct?.symbol ?? null,
    topGainerPct: bestPct?.pct ?? null,
    topLoserSymbol: worstPct?.symbol ?? null,
    topLoserPct: worstPct?.pct ?? null,
  };
}

function formatDigest(walletLabel: string, pnl: WalletPnl, summary: string | null): string {
  const sign = (n: number) => (n >= 0 ? "+" : "-");
  const lines = [
    `${walletLabel}:`,
    `💰 Realized: ${sign(pnl.realizedPnlUsd)}$${Math.abs(pnl.realizedPnlUsd).toFixed(0)}`,
    `📈 Unrealized: ${sign(pnl.unrealizedPnlUsd)}$${Math.abs(pnl.unrealizedPnlUsd).toFixed(0)}`,
    `🎯 Win rate: ${pnl.totalTrades > 0 ? Math.round((pnl.winningTrades / pnl.totalTrades) * 100) : 0}% (${pnl.winningTrades}/${pnl.totalTrades} trades)`,
  ];
  if (pnl.topGainerSymbol) lines.push(`🏆 Best: ${pnl.topGainerSymbol.slice(0, 4)}... +${(pnl.topGainerPct ?? 0).toFixed(0)}%`);
  if (pnl.topLoserSymbol) lines.push(`💀 Worst: ${pnl.topLoserSymbol.slice(0, 4)}... ${(pnl.topLoserPct ?? 0).toFixed(0)}%`);
  if (summary) lines.push("", summary);
  return lines.join("\n");
}

async function processDigest(): Promise<void> {
  const { data: wallets, error } = await supabase.from("kira_pnl_wallets").select("id, user_id, address, label");
  if (error) {
    console.error("[kira-workers:pnl-digest] wallet load failed:", error.message);
    return;
  }
  if (!wallets || wallets.length === 0) return;

  const solPriceUsd = (await jupiter.getPrice(SOL_MINT)) ?? 0;
  const today = new Date().toISOString().slice(0, 10);

  const byUser = new Map<string, typeof wallets>();
  for (const w of wallets) {
    const list = byUser.get(w.user_id) ?? [];
    list.push(w);
    byUser.set(w.user_id, list);
  }

  for (const [userId, userWallets] of byUser) {
    const digestSections: string[] = [];

    for (const wallet of userWallets) {
      try {
        const lastTsKey = `pnl:lastts:${wallet.address}`;
        const lastTs = Number((await redis.get(lastTsKey)) ?? 0);

        const trades = await deriveTrades(wallet.address, lastTs, solPriceUsd);
        if (trades.length === 0) continue;

        const newLastTs = Math.max(...trades.map((t) => t.timestamp));
        await redis.set(lastTsKey, String(newLastTs));

        const pnl = await computeWalletPnl(trades);

        await supabase.from("kira_pnl_snapshots").upsert(
          {
            user_id: userId,
            wallet_address: wallet.address,
            date: today,
            realized_pnl_usd: pnl.realizedPnlUsd,
            unrealized_pnl_usd: pnl.unrealizedPnlUsd,
            total_trades: pnl.totalTrades,
            winning_trades: pnl.winningTrades,
            top_gainer_symbol: pnl.topGainerSymbol,
            top_gainer_pct: pnl.topGainerPct,
            top_loser_symbol: pnl.topLoserSymbol,
            top_loser_pct: pnl.topLoserPct,
          },
          { onConflict: "user_id,wallet_address,date" },
        );

        // Sprint 10 Bug 6: individual trades alongside the daily snapshot, so the PnL History
        // tab can show real per-trade rows instead of one row per day. token_symbol stays null
        // here -- resolving it would mean a lookup per trade, and every consumer of this table
        // already treats a null symbol as "unknown," same honest-null pattern used elsewhere
        // (Dashboard, PnL stat grid). Insert (not upsert) since signature is globally unique;
        // errors are swallowed per-trade so one duplicate/conflict doesn't drop the rest of the
        // batch or fail the whole wallet's processing.
        for (const trade of trades) {
          const { error: tradeError } = await supabase.from("kira_pnl_trades").insert({
            user_id: userId,
            wallet_address: wallet.address,
            token_address: trade.tokenAddress,
            token_symbol: null,
            side: trade.side,
            token_amount: trade.tokenAmount,
            usd_value: trade.usdValue,
            price_at_trade: trade.tokenAmount > 0 ? trade.usdValue / trade.tokenAmount : null,
            signature: trade.signature,
            traded_at: new Date(trade.timestamp * 1000).toISOString(),
          });
          if (tradeError && tradeError.code !== "23505") {
            console.error("[kira-workers:pnl-digest] trade insert failed:", trade.signature, tradeError.message);
          }
        }

        digestSections.push(formatDigest(wallet.label || `${wallet.address.slice(0, 4)}...`, pnl, null));
      } catch (err) {
        console.error(
          "[kira-workers:pnl-digest] wallet processing failed:",
          wallet.address,
          err instanceof Error ? err.message : err,
        );
      }
    }

    if (digestSections.length === 0) continue;

    let summary: string | null = null;
    const budgetOk = await reserveGeminiBudget("pnl-digest", 150);
    if (budgetOk) {
      summary = await generateText(
        `Write one short, encouraging-but-honest sentence summarizing a crypto trader's day based on this PnL data: ${digestSections.join(" | ")}. No markdown, no disclaimers.`,
      );
    }

    const { data: profile } = await supabase
      .from("kira_profiles")
      .select("telegram_user_id")
      .eq("id", userId)
      .maybeSingle();

    if (profile?.telegram_user_id) {
      const message = [`📊 *Daily PnL Digest*`, new Date().toISOString().slice(0, 10), "", ...digestSections];
      if (summary) message.push("", summary);
      try {
        await telegramApi.sendMessage(profile.telegram_user_id, message.join("\n"), { parse_mode: "Markdown" });
      } catch (err) {
        console.error("[kira-workers:pnl-digest] telegram send failed:", err instanceof Error ? err.message : err);
      }
    }
  }
}

export function startPnlDigestWorker(): Worker {
  const worker = new Worker("kira-pnl-digest", processDigest, { connection: bullConnection, concurrency: 1 });
  return worker;
}
