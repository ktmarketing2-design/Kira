import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiRequest } from "../lib/api.js";
import type { DdCard } from "../lib/types.js";
import GeckoTerminalChart from "../token/GeckoTerminalChart.js";
import { getBuyBots } from "../token/buyBots.js";

interface ChartEvent {
  id: string;
  kind: string;
  timestamp: string;
  walletCount?: number;
  totalUsd?: number | null;
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

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diffMs / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function ChartStudioPage() {
  const { address } = useParams<{ address: string }>();
  const navigate = useNavigate();
  const [card, setCard] = useState<DdCard | null>(null);
  const [events, setEvents] = useState<ChartEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [holdersOpen, setHoldersOpen] = useState(false);

  useEffect(() => {
    if (!address) return;
    setCard(null);
    setError(null);
    apiRequest<DdCard>("GET", `/token/${address}/dd`)
      .then(setCard)
      .catch(() => setError("Couldn't generate a Deep Dive for this token."));

    apiRequest<{ alerts: ChartEvent[] }>("GET", `/token/${address}/events`)
      .then((res) => setEvents(res.alerts.filter((a) => a.kind.startsWith("cluster"))))
      .catch(() => setEvents([]));
  }, [address]);

  if (!address) return null;

  if (error) {
    return <div className="text-tt-red text-sm p-6">{error}</div>;
  }
  if (!card) {
    return <div className="text-tt-fg-dim text-sm p-6">Loading Chart Studio...</div>;
  }

  const bots = getBuyBots(card.graduated === true);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[65fr_35fr] gap-0 border border-tt-border rounded-md overflow-hidden">
      <div className="border-r border-tt-border overflow-hidden">
        <div className="flex items-center gap-4 p-4 border-b border-tt-border flex-wrap">
          <div className="w-9 h-9 border border-tt-border flex items-center justify-center font-display text-sm text-tt-green rounded-md">
            {(card.symbol ?? "?").slice(0, 1)}
          </div>
          <div>
            <div className="font-display text-sm text-tt-fg">{card.symbol ?? "?"}</div>
            <div className="text-[10px] text-tt-fg-faint">{fmtUsd(card.market.marketCapUsd)} MCAP</div>
          </div>
          <div className="flex gap-6 ml-4">
            <div>
              <div className="text-[10px] text-tt-fg-faint uppercase">Price</div>
              <div className="text-xs text-tt-fg">{card.market.priceUsd != null ? `$${card.market.priceUsd}` : "—"}</div>
            </div>
            <div>
              <div className="text-[10px] text-tt-fg-faint uppercase">Liquidity</div>
              <div className="text-xs text-tt-fg">{fmtUsd(card.market.liquidityUsd)}</div>
            </div>
            <div>
              <div className="text-[10px] text-tt-fg-faint uppercase">24h Vol</div>
              <div className="text-xs text-tt-fg">{fmtUsd(card.market.volume24hUsd)}</div>
            </div>
          </div>
          <button
            onClick={() => navigate(`/token/${address}`)}
            className="ml-auto text-xs border border-tt-border text-tt-fg-dim px-3 py-1.5 rounded-md hover:text-tt-fg"
          >
            ← Token Page
          </button>
        </div>

        <div className="p-3">
          <GeckoTerminalChart tokenAddress={address} pairAddress={card.market.pairAddress} />
        </div>
      </div>

      <div className="overflow-y-auto">
        <div className="p-4 border-b border-tt-border">
          <div className="text-[10px] uppercase tracking-wide text-tt-fg-faint mb-3 flex justify-between">
            <span>Execute Trade</span>
            <span>Deep Link</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {bots.map((bot) => (
              <a
                key={bot.label}
                href={bot.urlTemplate.replace("{address}", address)}
                target="_blank"
                rel="noreferrer"
                className="text-center py-2.5 border border-tt-border rounded-md text-xs text-tt-fg-dim hover:text-tt-fg"
              >
                {bot.label}
              </a>
            ))}
          </div>
        </div>

        <div className="p-4 border-b border-tt-border">
          <div className="text-[10px] uppercase tracking-wide text-tt-fg-faint mb-3 flex justify-between">
            <span>Security Audit</span>
            <span className={card.safety.rugScore >= 70 ? "text-tt-green" : "text-tt-red"}>●</span>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="border border-tt-border rounded-md p-2.5">
              <div className="text-[10px] text-tt-fg-faint mb-1.5">Bundled</div>
              <div className={`text-sm font-display ${(card.deepIntel?.bundlerSamplePct ?? 0) > 20 ? "text-tt-red" : "text-tt-green"}`}>
                {card.deepIntel?.bundlerSamplePct != null ? `${card.deepIntel.bundlerSamplePct.toFixed(0)}%` : "—"}
              </div>
            </div>
            <div className="border border-tt-border rounded-md p-2.5">
              <div className="text-[10px] text-tt-fg-faint mb-1.5">Snipers</div>
              <div className="text-sm font-display text-tt-fg">{card.deepIntel?.sniperCount ?? "—"}</div>
            </div>
            <div className="border border-tt-border rounded-md p-2.5">
              <div className="text-[10px] text-tt-fg-faint mb-1.5">Dev Holdings</div>
              <div className={`text-sm font-display ${(card.deepIntel?.devHoldingPct ?? 0) > 10 ? "text-tt-red" : "text-tt-green"}`}>
                {card.deepIntel?.devHoldingPct != null ? `${card.deepIntel.devHoldingPct.toFixed(1)}%` : "—"}
              </div>
            </div>
            <div className="border border-tt-border rounded-md p-2.5">
              <div className="text-[10px] text-tt-fg-faint mb-1.5">Top 10 Hold</div>
              <div className={`text-sm font-display ${(card.safety.top10HolderPct ?? 0) > 30 ? "text-tt-amber" : "text-tt-green"}`}>
                {card.safety.top10HolderPct != null ? `${card.safety.top10HolderPct.toFixed(2)}%` : "—"}
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 border-b border-tt-border">
          <div className="text-[10px] uppercase tracking-wide text-tt-fg-faint mb-3 flex justify-between">
            <span>Wallet Cluster Alert</span>
            <span className="text-tt-green">LIVE</span>
          </div>
          {events.length === 0 ? (
            <div className="text-xs text-tt-fg-faint">No cluster activity for this token yet.</div>
          ) : (
            events.slice(0, 5).map((e) => (
              <div key={e.id} className="flex justify-between py-2 border-t border-tt-border first:border-t-0 text-xs">
                <span className="text-tt-fg-dim">{e.walletCount ?? 0} wallets</span>
                <span className="text-tt-green">{fmtUsd(e.totalUsd ?? null)}</span>
                <span className="text-tt-fg-faint">{timeAgo(e.timestamp)}</span>
              </div>
            ))
          )}
        </div>

        <div className="p-4 border-b border-tt-border">
          <div className="text-[10px] uppercase tracking-wide text-tt-fg-faint mb-3">Addresses</div>
          <div className="flex justify-between text-xs py-1.5 text-tt-fg-dim">
            <span>Contract</span>
            <span className="text-tt-fg font-body">{truncate(address)}</span>
          </div>
          {card.safety.deployerAddress && (
            <div className="flex justify-between text-xs py-1.5 text-tt-fg-dim">
              <span>Dev</span>
              <span className="text-tt-fg font-body">{truncate(card.safety.deployerAddress)}</span>
            </div>
          )}
        </div>

        <div
          onClick={() => setHoldersOpen((o) => !o)}
          className="flex justify-between px-4 py-3 border-b border-tt-border text-xs text-tt-fg-dim cursor-pointer"
        >
          <span>HolderScan ({card.topHolders.length})</span>
          <span>{holdersOpen ? "▾" : "›"}</span>
        </div>
        {holdersOpen &&
          card.topHolders.slice(0, 10).map((h) => (
            <div key={h.address} className="flex justify-between px-4 py-2 border-b border-tt-border text-xs">
              <span className="text-tt-fg-dim font-body">{truncate(h.address)}</span>
              <span className={h.isDev ? "text-tt-amber" : "text-tt-fg-dim"}>
                {h.pct != null ? `${h.pct.toFixed(2)}%` : "—"}
                {h.isDev ? " (dev)" : ""}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}
