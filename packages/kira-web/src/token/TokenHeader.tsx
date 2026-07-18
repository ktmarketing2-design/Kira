import type { DdCard } from "../lib/types.js";
import type { TokenFullPriceStats } from "./TokenFullTabs.js";

export interface TokenFullMeta {
  symbol: string | null;
  name: string | null;
  logo: string | null;
  launchpad: string | null;
  createdAt: number | null;
  social: { twitter: string | null; telegram: string | null; website: string | null };
}

function truncate(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function fmtUsd(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

export default function TokenHeader({
  address,
  meta,
  card,
  priceStats,
}: {
  address: string;
  meta: TokenFullMeta;
  card: DdCard | null;
  priceStats: TokenFullPriceStats | null;
}) {
  return (
    <div className="flex items-center gap-6 flex-wrap py-3 mb-3 border-b border-tt-border">
      {/* Fallback avatar or Logo */}
      <div className="flex items-center gap-3">
        {meta.logo ? (
          <img src={meta.logo} alt="" className="w-9 h-9 rounded-md object-cover border border-tt-border" />
        ) : (
          <div className="w-9 h-9 border border-tt-border flex items-center justify-center font-display text-sm text-tt-green rounded-md bg-tt-bg-panel">
            {(meta.symbol ?? "?").slice(0, 1)}
          </div>
        )}
        <div>
          <div className="font-display text-sm text-tt-fg flex items-baseline gap-1.5">
            <span className="text-tt-green">${meta.symbol ?? "?"}</span>
            {meta.name && <span className="text-tt-fg-dim text-xs font-normal font-sans">({meta.name})</span>}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {meta.launchpad && (
              <span className="bg-tt-bg-raised border border-tt-border text-tt-brand text-[9px] px-1.5 py-0.5 rounded-md">
                {meta.launchpad}
              </span>
            )}
            <span className="text-tt-fg-faint font-body text-[10px] flex items-center gap-1">
              {truncate(address)}
              <button
                onClick={() => navigator.clipboard.writeText(address)}
                className="text-tt-green hover:opacity-80"
                aria-label="Copy address"
              >
                ⎘
              </button>
            </span>
          </div>
        </div>
      </div>

      {/* Social links */}
      <div className="flex items-center gap-2.5 text-tt-fg-dim text-xs">
        {meta.social.twitter && (
          <a
            href={`https://twitter.com/${meta.social.twitter}`}
            target="_blank"
            rel="noreferrer"
            className="hover:text-tt-fg"
          >
            𝕏
          </a>
        )}
        {meta.social.telegram && (
          <a href={meta.social.telegram} target="_blank" rel="noreferrer" className="hover:text-tt-fg">
            ✈️
          </a>
        )}
        {meta.social.website && (
          <a href={meta.social.website} target="_blank" rel="noreferrer" className="hover:text-tt-fg">
            🌐
          </a>
        )}
      </div>

      {/* Stats Row */}
      {card && (
        <div className="flex gap-6 ml-4 flex-wrap">
          <div>
            <div className="text-[10px] text-tt-fg-faint uppercase tracking-wider font-mono">Price</div>
            <div className="text-xs text-tt-fg font-mono">
              {card.market.priceUsd != null ? `$${card.market.priceUsd}` : "—"}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-tt-fg-faint uppercase tracking-wider font-mono">Liquidity</div>
            <div className="text-xs text-tt-fg font-mono">
              {fmtUsd(card.market.liquidityUsd)}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-tt-fg-faint uppercase tracking-wider font-mono">24h Vol</div>
            <div className="text-xs text-tt-fg font-mono">
              {fmtUsd(card.market.volume24hUsd)}
            </div>
          </div>
          {card.volume && (
            <div>
              <div className="text-[10px] text-tt-fg-faint uppercase tracking-wider font-mono">Vol Score</div>
              <div className={`text-xs font-mono font-bold ${card.volume.verdict === "organic" ? "text-tt-green" : "text-tt-amber"}`}>
                {card.volume.score}/100
              </div>
            </div>
          )}
        </div>
      )}

      {/* Returns Deltas */}
      {priceStats && (
        <div className="flex gap-5 ml-auto flex-wrap">
          <div className="text-right">
            <div className="text-[10px] text-tt-fg-faint font-mono">5m</div>
            <div className={`text-xs font-mono ${(priceStats.change5m ?? 0) >= 0 ? "text-tt-green" : "text-tt-red"}`}>
              {priceStats.change5m != null ? `${priceStats.change5m >= 0 ? "+" : ""}${priceStats.change5m.toFixed(2)}%` : "—"}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-tt-fg-faint font-mono">1h</div>
            <div className={`text-xs font-mono ${(priceStats.change1h ?? 0) >= 0 ? "text-tt-green" : "text-tt-red"}`}>
              {priceStats.change1h != null ? `${priceStats.change1h >= 0 ? "+" : ""}${priceStats.change1h.toFixed(2)}%` : "—"}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-tt-fg-faint font-mono">6h</div>
            <div className={`text-xs font-mono ${(priceStats.change6h ?? 0) >= 0 ? "text-tt-green" : "text-tt-red"}`}>
              {priceStats.change6h != null ? `${priceStats.change6h >= 0 ? "+" : ""}${priceStats.change6h.toFixed(2)}%` : "—"}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-tt-fg-faint font-mono">1d</div>
            <div className={`text-xs font-mono ${(priceStats.change24h ?? 0) >= 0 ? "text-tt-green" : "text-tt-red"}`}>
              {priceStats.change24h != null ? `${priceStats.change24h >= 0 ? "+" : ""}${priceStats.change24h.toFixed(2)}%` : "—"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
