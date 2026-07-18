import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../lib/api.js";
import type { Alert, DdCard } from "../lib/types.js";
import KolCallDetailsModal from "../token/KolCallDetailsModal.js";

interface KolCall {
  id: string;
  sourceId: string;
  sourceType: "telegram" | "gmgn_kol";
  tokenAddress: string;
  calledAt: string;
  priceAtCall: number | null;
}

type SignalKind = "cluster" | "kol" | "filter";

interface SignalRow {
  id: string;
  kind: SignalKind;
  tokenAddress: string;
  tokenSymbol: string | null;
  description: string;
  timestamp: string;
}

interface RawCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface ChartEvent {
  id: string;
  kind: string;
  timestamp: string;
  walletCount?: number;
}

const FILTERS: { id: "all" | SignalKind; label: string }[] = [
  { id: "all", label: "All" },
  { id: "cluster", label: "Cluster" },
  { id: "kol", label: "KOL" },
  { id: "filter", label: "Rug Flag" },
];

function alertToSignal(a: Alert): SignalRow | null {
  if (a.type === "cluster_buy" || a.type === "new_token_cluster") {
    return {
      id: a.id,
      kind: "cluster",
      tokenAddress: a.token_address,
      tokenSymbol: a.token_symbol,
      description: `${a.wallet_count} tracked wallet${a.wallet_count === 1 ? "" : "s"} bought`,
      timestamp: a.created_at,
    };
  }
  if (a.type === "cluster_sell") {
    return {
      id: a.id,
      kind: "cluster",
      tokenAddress: a.token_address,
      tokenSymbol: a.token_symbol,
      description: `${a.wallet_count} tracked wallet${a.wallet_count === 1 ? "" : "s"} sold`,
      timestamp: a.created_at,
    };
  }
  if (a.type === "signal_filter_match") {
    return {
      id: a.id,
      kind: "filter",
      tokenAddress: a.token_address,
      tokenSymbol: a.token_symbol,
      description: "LP unlock detected, mint authority active",
      timestamp: a.created_at,
    };
  }
  return null;
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmtUsd(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

interface TimelineKolCall {
  id: string;
  sourceId: string;
  timestamp: string;
  priceAtCall: number | null;
}

function CallTimeline({
  tokenAddress,
  pairAddress,
  currentPriceUsd,
  onSelectKolCall,
}: {
  tokenAddress: string;
  pairAddress: string | null;
  currentPriceUsd: number | null;
  onSelectKolCall?: (kol: { sourceId: string; sourceName: string; calledAt: string; priceAtCall: number | null }) => void;
}) {
  const [candles, setCandles] = useState<RawCandle[]>([]);
  const [events, setEvents] = useState<{ alerts: ChartEvent[]; kolCalls: TimelineKolCall[] }>({ alerts: [], kolCalls: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!pairAddress) {
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([
      apiRequest<{ candles: RawCandle[] }>(
        "GET",
        `/token/${tokenAddress}/ohlcv?timeframe=1h&pairAddress=${encodeURIComponent(pairAddress)}`,
      ),
      apiRequest<{ alerts: ChartEvent[]; kolCalls: TimelineKolCall[] }>("GET", `/token/${tokenAddress}/events`),
    ])
      .then(([ohlcv, ev]) => {
        setCandles([...ohlcv.candles].sort((a, b) => a.timestamp - b.timestamp));
        setEvents(ev);
      })
      .catch(() => {
        setCandles([]);
        setEvents({ alerts: [], kolCalls: [] });
      })
      .finally(() => setLoading(false));
  }, [tokenAddress, pairAddress]);

  if (!pairAddress) {
    return <div className="text-xs text-tt-fg-faint py-6 text-center">No trading pair for this token yet.</div>;
  }
  if (loading) {
    return <div className="text-xs text-tt-fg-faint py-6 text-center">Loading...</div>;
  }
  if (candles.length === 0) {
    return <div className="text-xs text-tt-fg-faint py-6 text-center">No price history yet.</div>;
  }

  const w = 300;
  const h = 130;
  const pad = 10;
  const closes = candles.map((c) => c.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const x = (i: number) => pad + (i / (candles.length - 1)) * (w - pad * 2);
  const y = (v: number) => h - pad - ((v - min) / range) * (h - pad * 2);
  const pathD = candles.map((c, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(c.close)}`).join(" ");

  function nearestIndex(unixSeconds: number): number {
    let best = 0;
    let bestDiff = Infinity;
    candles.forEach((c, i) => {
      const diff = Math.abs(c.timestamp - unixSeconds);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = i;
      }
    });
    return best;
  }

  const markers = [
    ...events.alerts.map((a) => ({
      idx: nearestIndex(Math.floor(new Date(a.timestamp).getTime() / 1000)),
      color: "#4AF626",
      label: a.walletCount != null ? `${a.walletCount} wallets` : "cluster",
    })),
    ...events.kolCalls.map((c) => ({
      idx: nearestIndex(Math.floor(new Date(c.timestamp).getTime() / 1000)),
      color: "#E6A817",
      label: "KOL call",
    })),
  ];

  const timelineItems = (() => {
    const list: Array<{ who: string; price: number | null; timestamp: string; kind: "kol" | "cluster"; sourceId?: string }> = [];
    
    events.kolCalls.forEach((c) => {
      const who = c.sourceId ? (c.sourceId.startsWith("@") ? c.sourceId : `@${c.sourceId}`) : "KOL Call";
      list.push({
        who,
        price: c.priceAtCall,
        timestamp: c.timestamp,
        kind: "kol",
        sourceId: c.sourceId,
      });
    });

    events.alerts.forEach((a) => {
      const idx = nearestIndex(Math.floor(new Date(a.timestamp).getTime() / 1000));
      const price = candles[idx]?.close ?? null;
      list.push({
        who: `Cluster (${a.walletCount ?? 0} wallets)`,
        price,
        timestamp: a.timestamp,
        kind: "cluster"
      });
    });

    return list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  })();

  return (
    <div>
      <div className="border border-tt-border rounded-md bg-tt-bg mb-3">
        <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="130">
          <path d={pathD} stroke="#4AF626" strokeWidth={1.5} fill="none" />
          {markers.map((m, i) => (
            <g key={i}>
              <line x1={x(m.idx)} y1={0} x2={x(m.idx)} y2={h} stroke={m.color} strokeOpacity={0.25} strokeDasharray="2,2" />
              <circle cx={x(m.idx)} cy={y(closes[m.idx])} r={4} fill={m.color} stroke="#0A0A0A" strokeWidth={1.5} />
            </g>
          ))}
        </svg>
      </div>
      <div className="flex gap-4 text-[10px] text-tt-fg-dim mb-3">
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-tt-amber inline-block" /> KOL call
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-tt-green inline-block" /> Cluster buy
        </span>
      </div>

      {/* Call Timeline list from mockup */}
      <div className="call-list space-y-2 mt-4 pt-4 border-t border-tt-border">
        {timelineItems.slice(0, 5).map((item, idx) => {
          const delta = item.price && currentPriceUsd
            ? ((currentPriceUsd - item.price) / item.price) * 100
            : null;
          const isKol = item.kind === "kol";
          return (
            <div
              key={idx}
              onClick={() => {
                if (isKol && onSelectKolCall && item.sourceId) {
                  onSelectKolCall({
                    sourceId: item.sourceId,
                    sourceName: item.who,
                    calledAt: item.timestamp,
                    priceAtCall: item.price,
                  });
                }
              }}
              className={`call-item flex flex-col gap-0.5 text-xs py-1.5 border-b border-tt-border last:border-b-0 ${isKol ? "hover:text-tt-brand cursor-pointer" : ""}`}
            >
              <div className="flex justify-between items-center">
                <span className="who font-medium text-tt-fg">{item.who}</span>
                {delta != null && (
                  <span className={`delta text-[10px] font-mono ${delta >= 0 ? "text-tt-green" : "text-tt-red"}`}>
                    {delta >= 0 ? "+" : ""}{delta.toFixed(1)}% since
                  </span>
                )}
              </div>
              <span className="at text-[10px] text-tt-fg-dim font-mono">
                {isKol ? "called" : "bought"} at {item.price != null ? `$${item.price.toFixed(6)}` : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DdSidebar({ tokenAddress }: { tokenAddress: string }) {
  const [card, setCard] = useState<DdCard | null>(null);
  const [error, setError] = useState(false);
  const [selectedKolCall, setSelectedKolCall] = useState<{
    sourceId: string;
    sourceName: string;
    calledAt: string;
    priceAtCall: number | null;
  } | null>(null);

  useEffect(() => {
    setCard(null);
    setError(false);
    apiRequest<DdCard>("GET", `/token/${tokenAddress}/dd`)
      .then(setCard)
      .catch(() => setError(true));
  }, [tokenAddress]);

  if (error) {
    return <div className="p-5 text-tt-fg-dim text-sm">Couldn't load a Deep Dive for this token.</div>;
  }
  if (!card) {
    return <div className="p-5 text-tt-fg-dim text-sm">Loading...</div>;
  }

  return (
    <div className="bg-tt-bg-raised border border-tt-border rounded-md divide-y divide-tt-border">
      {/* Title block */}
      <div className="p-5">
        <div className="flex items-baseline gap-2 flex-wrap mb-1">
          <span className="font-display text-lg text-tt-green">${card.symbol ?? "TOKEN"}</span>
          {card.name && <span className="text-tt-fg-dim text-xs">({card.name})</span>}
        </div>
        <div className="text-[10px] text-tt-fg-faint font-body break-all mb-2.5">
          {card.tokenAddress}{" "}
          <button
            onClick={() => void navigator.clipboard.writeText(card.tokenAddress)}
            className="text-tt-green hover:underline cursor-pointer ml-1 text-[10px]"
          >
            Copy
          </button>
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          <span className="border border-tt-border rounded-md px-2 py-0.5 text-tt-fg-dim">Solana</span>
          {card.graduated && <span className="text-tt-amber">✓ Graduated to PumpSwap</span>}
        </div>
      </div>

      {/* Call Timeline with interactive graphic and event items list */}
      <div className="p-5">
        <div className="text-[10px] uppercase tracking-wide text-tt-fg-faint mb-3 flex justify-between">
          <span>Call Timeline</span>
          <span className="text-tt-fg-faint font-mono">Price vs. calls</span>
        </div>
        <CallTimeline
          tokenAddress={tokenAddress}
          pairAddress={card.market.pairAddress}
          currentPriceUsd={card.market.priceUsd}
          onSelectKolCall={setSelectedKolCall}
        />
      </div>

      {/* Safety Score Card */}
      <div className="p-5">
        <div className="text-[10px] uppercase tracking-wide text-tt-fg-faint mb-3">Safety</div>
        <div className="flex justify-between items-baseline mb-3">
          <span className="font-display text-xl text-tt-green">{card.safety.rugScore}/100</span>
          <span className="text-[10px] text-tt-fg-faint uppercase">Rug Score</span>
        </div>
        <div className="space-y-1.5">
          <div className={`text-xs ${card.safety.mintAuthorityRevoked ? "text-tt-green" : "text-tt-amber"}`}>
            {card.safety.mintAuthorityRevoked ? "✓" : "⚠"} Mint revoked
          </div>
          <div className={`text-xs ${card.safety.freezeAuthorityRevoked ? "text-tt-green" : "text-tt-amber"}`}>
            {card.safety.freezeAuthorityRevoked ? "✓" : "⚠"} Freeze revoked
          </div>
          <div className={`text-xs ${card.safety.lpLocked ? "text-tt-green" : "text-tt-amber"}`}>
            {card.safety.lpLocked ? "✓" : "⚠"} LP locked
          </div>
          <div className={`text-xs ${card.safety.honeypotClean ? "text-tt-green" : "text-tt-amber"}`}>
            {card.safety.honeypotClean ? "✓" : "⚠"} Not honeypot
          </div>
          {card.safety.top10HolderPct != null && (
            <div className="text-xs text-tt-fg-dim pt-1.5 border-t border-tt-border">
              Top 10: {card.safety.top10HolderPct.toFixed(1)}% supply
            </div>
          )}
        </div>
      </div>

      {/* Volume score details */}
      {card.volume && (
        <div className="p-5">
          <div className="text-[10px] uppercase tracking-wide text-tt-fg-faint mb-3">Volume</div>
          <div className="flex justify-between items-baseline mb-3">
            <span className={`font-display text-xl ${card.volume.verdict === "organic" ? "text-tt-green" : "text-tt-amber"}`}>
              {card.volume.score}/100
            </span>
            <span className="text-[10px] text-tt-fg-faint uppercase">Vol Score ({card.volume.verdict})</span>
          </div>
          <div className="space-y-1">
            {card.volume.signals.map((s) => {
              const METRIC_LABELS: Record<string, string> = {
                vol_liq_ratio: "Vol/liq ratio",
                wallet_diversity: "Wallet diversity",
                timing_entropy: "Timing entropy",
                new_wallet_ratio: "New wallet ratio",
                fdv_liq_ratio: "FDV/liq ratio",
                round_size_prevalence: "Round size prevalence",
              };
              return (
                <div key={s.name} className="flex justify-between text-xs py-1 border-t border-tt-border first:border-t-0 text-tt-fg-dim font-mono">
                  <span>{METRIC_LABELS[s.name] ?? s.name.replace(/_/g, " ")}</span>
                  <span className={s.flag ? "text-tt-amber" : "text-tt-fg"}>{s.value.toFixed(2)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Market details */}
      <div className="p-5">
        <div className="text-[10px] uppercase tracking-wide text-tt-fg-faint mb-3">Market</div>
        <div className="flex justify-between text-xs py-1 text-tt-fg-dim font-mono">
          <span>Mcap</span>
          <span className="text-tt-fg">{fmtUsd(card.market.fdvUsd)}</span>
        </div>
        <div className="flex justify-between text-xs py-1 text-tt-fg-dim font-mono">
          <span>Liquidity</span>
          <span className="text-tt-fg">{fmtUsd(card.market.liquidityUsd)}</span>
        </div>
        <div className="flex justify-between text-xs py-1 text-tt-fg-dim font-mono">
          <span>24h Vol</span>
          <span className="text-tt-fg">{fmtUsd(card.market.volume24hUsd)}</span>
        </div>
      </div>

      {/* Social signals */}
      <div className="p-5">
        <div className="text-[10px] uppercase tracking-wide text-tt-fg-faint mb-3">Social</div>
        <div className="flex justify-between text-xs py-1 text-tt-fg-dim font-mono">
          <span>KOL mentions</span>
          <span className="text-tt-fg">{card.socialSignals.kolMentions}</span>
        </div>
        <div className="flex justify-between text-xs py-1 text-tt-fg-dim font-mono">
          <span>X followers</span>
          <span className="text-tt-fg">{card.socialSignals.totalTrackedChannels} channels</span>
        </div>
      </div>

      {/* Quick Bot Trade Execution */}
      <div className="p-5">
        <div className="text-[10px] uppercase tracking-wide text-tt-fg-faint mb-3">Execute</div>
        <div className="flex gap-2">
          <a
            href={`https://t.me/solana_trojanbot?start=${card.tokenAddress}`}
            target="_blank"
            rel="noreferrer"
            className="flex-1 text-center py-2.5 border border-tt-green text-xs text-tt-green rounded-md hover:opacity-80"
          >
            Trojan
          </a>
          <a
            href={`https://t.me/BullxNeoBot?start=${card.tokenAddress}`}
            target="_blank"
            rel="noreferrer"
            className="flex-1 text-center py-2.5 border border-tt-border text-xs text-tt-fg-dim rounded-md hover:text-tt-fg hover:border-tt-brand"
          >
            BullX
          </a>
        </div>
      </div>

      {selectedKolCall && (
        <KolCallDetailsModal
          sourceId={selectedKolCall.sourceId}
          sourceName={selectedKolCall.sourceName}
          calledAt={selectedKolCall.calledAt}
          priceAtCall={selectedKolCall.priceAtCall}
          currentPriceUsd={card.market.priceUsd}
          tokenSymbol={card.symbol ?? "TOKEN"}
          onClose={() => setSelectedKolCall(null)}
        />
      )}
    </div>
  );
}

export default function SignalsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [kolCalls, setKolCalls] = useState<KolCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | SignalKind>("all");
  const [selected, setSelected] = useState<SignalRow | null>(null);

  useEffect(() => {
    Promise.all([
      apiRequest<{ alerts: Alert[] }>("GET", "/alerts"),
      apiRequest<{ calls: KolCall[] }>("GET", "/kol/calls"),
    ])
      .then(([alertsRes, callsRes]) => {
        setAlerts(alertsRes.alerts);
        setKolCalls(callsRes.calls);
      })
      .catch(() => {
        setAlerts([]);
        setKolCalls([]);
      })
      .finally(() => setLoading(false));
  }, []);

  const signals = useMemo<SignalRow[]>(() => {
    const fromAlerts = alerts.map(alertToSignal).filter((s): s is SignalRow => s != null);
    const fromKol: SignalRow[] = kolCalls.map((c) => ({
      id: `kol-${c.id}`,
      kind: "kol",
      tokenAddress: c.tokenAddress,
      tokenSymbol: null,
      description: "KOL call",
      timestamp: c.calledAt,
    }));
    return [...fromAlerts, ...fromKol].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }, [alerts, kolCalls]);

  const filtered = filter === "all" ? signals : signals.filter((s) => s.kind === filter);

  useEffect(() => {
    if (!selected && filtered.length > 0) setSelected(filtered[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered.length]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-0 border border-tt-border rounded-md overflow-hidden" style={{ minHeight: "calc(100vh - 130px)" }}>
      <div className="border-r border-tt-border overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-tt-border">
          <h1 className="font-display uppercase text-lg text-tt-fg">Signal Feed</h1>
          <div className="flex gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`text-xs px-3.5 py-1.5 rounded-md border ${
                  filter === f.id ? "border-tt-brand text-tt-brand" : "border-tt-border text-tt-fg-dim"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-tt-fg-dim text-sm">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-tt-fg-dim text-sm">No signals yet for this filter.</div>
        ) : (
          filtered.map((s) => (
            <div
              key={s.id}
              onClick={() => setSelected(s)}
              className={`grid grid-cols-[44px_1fr_auto_auto] items-center gap-4 px-7 py-4 border-b border-tt-border cursor-pointer ${
                selected?.id === s.id ? "bg-tt-bg-panel border-l-2 border-l-tt-green pl-[26px]" : "hover:bg-tt-bg-panel"
              }`}
            >
              <div className="w-9 h-9 border border-tt-border flex items-center justify-center font-display text-sm text-tt-green rounded-md">
                {(s.tokenSymbol ?? s.tokenAddress).slice(0, 1).toUpperCase()}
              </div>
              <div>
                <div className="font-display text-sm text-tt-fg">${s.tokenSymbol ?? s.tokenAddress.slice(0, 6)}</div>
                <div className="text-xs text-tt-fg-dim mt-0.5">{s.description}</div>
              </div>
              <div
                className={`text-[10px] uppercase tracking-wide px-2 py-1 rounded-md border ${
                  s.kind === "cluster"
                    ? "text-tt-green border-tt-green"
                    : s.kind === "kol"
                      ? "text-tt-amber border-tt-amber"
                      : "text-tt-red border-tt-red"
                }`}
              >
                {s.kind === "cluster" ? "Cluster" : s.kind === "kol" ? "KOL Call" : "Rug Flag"}
              </div>
              <div className="text-[10px] text-tt-fg-faint text-right">{timeAgo(s.timestamp)}</div>
            </div>
          ))
        )}
      </div>

      <div className="overflow-y-auto">
        {selected ? (
          <DdSidebar tokenAddress={selected.tokenAddress} />
        ) : (
          <div className="p-8 text-center text-tt-fg-faint text-sm">Select a signal to view its DD card.</div>
        )}
      </div>
    </div>
  );
}
