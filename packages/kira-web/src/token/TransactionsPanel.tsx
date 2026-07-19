import { useEffect, useState } from "react";
import { Brain, Mic, Rat, Bot, AlertTriangle } from "lucide-react";
import { apiRequest } from "../lib/api.js";

const REFRESH_INTERVAL_MS = 30_000;
const PAGE_SIZE = 20;
const TAG_ICONS: Record<string, typeof Brain> = {
  smart_degen: Brain,
  renowned: Mic,
  rat_trader: Rat,
  bundler: Bot,
};

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

type SideFilter = "all" | "buy" | "sell";
type SizeFilter = "all" | "whale" | "mid" | "small";

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

function matchesSize(usdValue: number, filter: SizeFilter): boolean {
  if (filter === "all") return true;
  if (filter === "whale") return usdValue >= 10_000;
  if (filter === "mid") return usdValue >= 1_000 && usdValue < 10_000;
  return usdValue < 1_000;
}

export default function TransactionsPanel({
  tokenAddress,
  walletTags,
  onOpenProfile,
}: {
  tokenAddress: string;
  walletTags?: Map<string, string[]>;
  onOpenProfile?: (address: string) => void;
}) {
  const [trades, setTrades] = useState<GroupedTrade[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [sideFilter, setSideFilter] = useState<SideFilter>("all");
  const [sizeFilter, setSizeFilter] = useState<SizeFilter>("all");
  const [limit, setLimit] = useState(PAGE_SIZE);

  function load(currentLimit: number) {
    apiRequest<{ transactions: RawTransaction[]; source?: "unavailable" }>(
      "GET",
      `/token/${tokenAddress}/transactions?limit=${currentLimit}`,
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
    setLimit(PAGE_SIZE);
    load(PAGE_SIZE);
    const interval = setInterval(() => load(limit), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenAddress]);

  function loadMore() {
    const next = limit + PAGE_SIZE;
    setLimit(next);
    load(next);
  }

  if (trades === null) {
    return <div className="text-tt-fg-dim text-sm py-8 text-center font-mono animate-pulse">Loading transactions...</div>;
  }

  if (unavailable) {
    return (
      <div className="bg-tt-bg-raised border border-tt-border rounded-md p-8 text-center text-tt-fg-dim text-sm font-mono flex flex-col items-center gap-2">
        <AlertTriangle size={16} className="text-tt-amber" />
        Helius RPC Limit exceeded (429: max usage reached). Please upgrade your Helius API Key in your .env file on the VPS.
      </div>
    );
  }

  if (trades.length === 0) {
    return (
      <div className="bg-tt-bg-raised border border-tt-border rounded-md p-8 text-center text-tt-fg-dim text-sm font-mono">
        No recent transaction data available for this token.
      </div>
    );
  }

  const filtered = trades.filter(
    (t) => (sideFilter === "all" || t.side === sideFilter) && matchesSize(t.usdValue, sizeFilter),
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
        <div className="flex gap-1">
          {(["all", "buy", "sell"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setSideFilter(v)}
              className={`px-2 py-1 rounded-md border ${
                sideFilter === v ? "border-tt-brand text-tt-brand" : "border-tt-border text-tt-fg-dim"
              }`}
            >
              {v === "all" ? "All" : v === "buy" ? "Buys" : "Sells"}
            </button>
          ))}
        </div>
        <span className="text-tt-fg-faint">|</span>
        <div className="flex gap-1">
          {(["all", "whale", "mid", "small"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setSizeFilter(v)}
              className={`px-2 py-1 rounded-md border ${
                sizeFilter === v ? "border-tt-brand text-tt-brand" : "border-tt-border text-tt-fg-dim"
              }`}
            >
              {v === "all" ? "All sizes" : v === "whale" ? "Whales >$10K" : v === "mid" ? "Mid $1K-10K" : "Small <$1K"}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-tt-bg-raised border border-tt-border rounded-md divide-y divide-tt-border">
        {filtered.map((t) => {
          const tags = walletTags?.get(t.walletFull) ?? [];
          return (
            <div key={t.signature} className="flex items-center justify-between px-4 py-2 text-xs font-data">
              <span className={`w-12 font-medium ${t.side === "buy" ? "text-tt-green" : "text-tt-red"}`}>
                {t.side === "buy" ? "BUY" : "SELL"}
              </span>
              <span className={`w-20 ${t.side === "buy" ? "text-tt-green" : "text-tt-red"}`}>
                ${t.usdValue >= 1000 ? `${(t.usdValue / 1000).toFixed(1)}K` : t.usdValue.toFixed(2)}
              </span>
              <button
                onClick={() => onOpenProfile?.(t.walletFull)}
                className="flex-1 text-left text-tt-brand hover:underline flex items-center gap-1"
              >
                {t.wallet}
                {tags.map((tag) => {
                  const Icon = TAG_ICONS[tag];
                  return Icon ? (
                    <span key={tag} title={tag}>
                      <Icon size={11} className="inline" />
                    </span>
                  ) : null;
                })}
              </button>
              <span className="text-tt-fg-faint">{t.timeAgo}</span>
            </div>
          );
        })}
      </div>

      <div className="text-center mt-3">
        <button
          onClick={loadMore}
          className="text-xs px-3 py-1.5 rounded-md border border-tt-border text-tt-fg-dim hover:text-tt-fg hover:border-tt-brand"
        >
          Load more
        </button>
      </div>
    </div>
  );
}
