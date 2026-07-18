import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api.js";

interface KolCallModalProps {
  sourceId: string;
  sourceName: string;
  calledAt: string;
  priceAtCall: number | null;
  currentPriceUsd: number | null;
  tokenSymbol: string;
  tokenAddress: string;
  onClose: () => void;
}

interface KolSourceStats {
  id: string;
  platform: string;
  displayName: string;
  channelIdentifier: string;
  totalCalls: number;
  winRate24h: number | null;
  winRate7d: number | null;
  avgReturn24h: number | null;
}

export default function KolCallDetailsModal({
  sourceId,
  sourceName,
  calledAt,
  priceAtCall,
  currentPriceUsd,
  tokenSymbol,
  tokenAddress,
  onClose,
}: KolCallModalProps) {
  const [stats, setStats] = useState<KolSourceStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiRequest<{ sources: KolSourceStats[] }>("GET", "/kol/sources")
      .then((res) => {
        const found = res.sources.find((s) => s.id === sourceId || s.displayName === sourceName || s.channelIdentifier === sourceName);
        if (found) setStats(found);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [sourceId, sourceName]);

  const delta = priceAtCall && currentPriceUsd
    ? ((currentPriceUsd - priceAtCall) / priceAtCall) * 100
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-tt-bg/85 backdrop-blur-sm p-4">
      <div className="bg-tt-bg-panel border border-tt-border rounded-lg max-w-md w-full overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex justify-between items-center px-5 py-4 border-b border-tt-border font-mono">
          <div className="flex items-center gap-2">
            <span className="text-base text-tt-amber">📢</span>
            <span className="font-display text-sm text-tt-fg">{sourceName} call details</span>
          </div>
          <button onClick={onClose} className="text-tt-fg-dim hover:text-tt-fg text-base cursor-pointer">
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 font-mono">
          {/* KOL stats section */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-tt-fg-faint mb-2.5">KOL Performance Stats</div>
            {loading ? (
              <div className="text-xs text-tt-fg-dim animate-pulse py-2">Loading performance stats...</div>
            ) : stats ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-tt-bg border border-tt-border p-3 rounded-md">
                  <div className="text-[10px] text-tt-fg-faint">7D Win Rate</div>
                  <div className="text-sm font-semibold text-tt-fg font-mono mt-0.5">
                    {stats.winRate7d != null ? `${(stats.winRate7d * 100).toFixed(0)}%` : "—"}
                  </div>
                </div>
                <div className="bg-tt-bg border border-tt-border p-3 rounded-md">
                  <div className="text-[10px] text-tt-fg-faint">Avg 24h Return (PnL)</div>
                  <div className={`text-sm font-semibold font-mono mt-0.5 ${stats.avgReturn24h != null && stats.avgReturn24h >= 0 ? "text-tt-green" : stats.avgReturn24h != null ? "text-tt-red" : "text-tt-fg-dim"}`}>
                    {stats.avgReturn24h != null ? `${stats.avgReturn24h >= 0 ? "+" : ""}${stats.avgReturn24h.toFixed(1)}%` : "—"}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-xs text-tt-fg-faint py-2">No historical performance stats available.</div>
            )}
          </div>

          {/* Call stats section */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-tt-fg-faint mb-2">Call Details</div>
            <div className="bg-tt-bg border border-tt-border rounded-md divide-y divide-tt-border">
              <div className="flex justify-between px-4 py-2.5 text-xs">
                <span className="text-tt-fg-dim">Called Token</span>
                <span className="text-tt-green font-semibold">${tokenSymbol}</span>
              </div>
              <div className="flex justify-between px-4 py-2.5 text-xs">
                <span className="text-tt-fg-dim">Price at Call</span>
                <span className="text-tt-fg font-mono">${priceAtCall != null ? priceAtCall.toFixed(6) : "—"}</span>
              </div>
              <div className="flex justify-between px-4 py-2.5 text-xs">
                <span className="text-tt-fg-dim">Current Price</span>
                <span className="text-tt-fg font-mono">${currentPriceUsd != null ? currentPriceUsd.toFixed(6) : "—"}</span>
              </div>
              <div className="flex justify-between px-4 py-2.5 text-xs">
                <span className="text-tt-fg-dim">Return since Call</span>
                <span className={`font-mono font-semibold ${delta != null && delta >= 0 ? "text-tt-green" : delta != null ? "text-tt-red" : "text-tt-fg-dim"}`}>
                  {delta != null ? `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%` : "—"}
                </span>
              </div>
              <div className="flex justify-between px-4 py-2.5 text-xs">
                <span className="text-tt-fg-dim">Called At</span>
                <span className="text-tt-fg font-mono">{new Date(calledAt).toLocaleString()}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 bg-tt-bg/50 border-t border-tt-border flex justify-end font-mono">
          <button
            onClick={onClose}
            className="bg-tt-bg border border-tt-border text-tt-fg hover:border-tt-brand rounded-md px-4 py-2 text-xs font-medium cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
