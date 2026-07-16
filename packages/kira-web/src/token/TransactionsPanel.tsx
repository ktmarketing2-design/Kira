import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api.js";

const REFRESH_INTERVAL_MS = 30_000;

interface RawTransaction {
  signature: string;
  wallet: string;
  walletFull: string;
  side: "buy" | "sell";
  usdValue: number;
  tokenAmount: number;
  timestamp: number;
  timeAgo: string;
}

interface GroupedTrade {
  signature: string;
  side: "buy" | "sell";
  usdValue: number;
  wallet: string;
  walletFull: string;
  timestamp: number;
  timeAgo: string;
}

/** One row per unique signature, not per token-transfer leg: a single swap can produce several
 * legs (router hops through intermediate accounts) that all share a signature. USD values of
 * legs sharing a signature are summed; side/wallet/timestamp are taken from the first leg since
 * they're the same trade. */
function groupBySignature(transactions: RawTransaction[]): GroupedTrade[] {
  const bySignature = new Map<string, GroupedTrade>();
  for (const tx of transactions) {
    const existing = bySignature.get(tx.signature);
    if (existing) {
      existing.usdValue += tx.usdValue;
    } else {
      bySignature.set(tx.signature, {
        signature: tx.signature,
        side: tx.side,
        usdValue: tx.usdValue,
        wallet: tx.wallet,
        walletFull: tx.walletFull,
        timestamp: tx.timestamp,
        timeAgo: tx.timeAgo,
      });
    }
  }
  return Array.from(bySignature.values()).sort((a, b) => b.timestamp - a.timestamp);
}

export default function TransactionsPanel({ tokenAddress }: { tokenAddress: string }) {
  const [trades, setTrades] = useState<GroupedTrade[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  function load() {
    apiRequest<{ transactions: RawTransaction[]; source?: "unavailable" }>(
      "GET",
      `/token/${tokenAddress}/transactions`,
    )
      .then((res) => {
        setUnavailable(res.source === "unavailable");
        setTrades(groupBySignature(res.transactions));
      })
      .catch(() => {
        setUnavailable(true);
        setTrades([]);
      });
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenAddress]);

  if (trades === null) {
    return <div className="text-kira-text-muted text-sm py-8 text-center">Loading transactions...</div>;
  }

  if (unavailable || trades.length === 0) {
    return (
      <div className="bg-kira-surface border border-kira-border rounded-md p-8 text-center text-kira-text-muted text-sm">
        No recent transaction data available for this token.
      </div>
    );
  }

  return (
    <div className="bg-kira-surface border border-kira-border rounded-md divide-y divide-kira-border">
      {trades.map((t) => (
        <div key={t.signature} className="flex items-center justify-between px-4 py-2 text-xs font-data">
          <span className={`w-12 font-medium ${t.side === "buy" ? "text-kira-green" : "text-kira-red"}`}>
            {t.side === "buy" ? "BUY" : "SELL"}
          </span>
          <span className={`w-20 ${t.side === "buy" ? "text-kira-green" : "text-kira-red"}`}>
            ${t.usdValue >= 1000 ? `${(t.usdValue / 1000).toFixed(1)}K` : t.usdValue.toFixed(2)}
          </span>
          <a
            href={`https://solscan.io/account/${t.walletFull}`}
            target="_blank"
            rel="noreferrer"
            className="flex-1 text-kira-accent hover:underline"
          >
            {t.wallet}
          </a>
          <span className="text-kira-text-dim">{t.timeAgo}</span>
        </div>
      ))}
    </div>
  );
}
