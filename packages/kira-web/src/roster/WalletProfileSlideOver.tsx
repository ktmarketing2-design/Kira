import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest, ApiError } from "../lib/api.js";

interface WalletProfileStats {
  realizedProfit: number | null;
  realizedProfitPnl: number | null;
  buys: number;
  sells: number;
  totalTrades: number;
  winRate: number | null;
  tokenCount: number | null;
  avgHoldingPeriodSeconds: number | null;
  pnlGt5x: number | null;
  pnl0to2x: number | null;
  tags: string[];
  nativeBalance: number | null;
}

interface WalletHolding {
  tokenAddress: string | null;
  symbol: string | null;
  name: string | null;
  logo: string | null;
  price: number | null;
  balance: number | null;
  usdValue: number | null;
  realizedProfit: number | null;
  realizedProfitPnl: number | null;
}

interface WalletActivity {
  txHash: string | null;
  tokenAddress: string | null;
  symbol: string | null;
  side: "buy" | "sell";
  usdValue: number | null;
  timestamp: number | null;
}

interface WalletProfile {
  address: string;
  stats: WalletProfileStats;
  holdings: WalletHolding[];
  recentActivity: WalletActivity[];
}

function truncate(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function fmtUsd(v: number | null): string {
  if (v == null) return "—";
  const sign = v >= 0 ? "+" : "";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}$${(v / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(v / 1_000).toFixed(1)}K`;
  return `${sign}$${v.toFixed(0)}`;
}

function fmtPct(v: number | null): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(0)}%`;
}

function pctClass(v: number | null): string {
  if (v == null) return "text-kira-text-dim";
  return v >= 0 ? "text-kira-green" : "text-kira-red";
}

function fmtHold(seconds: number | null): string {
  if (seconds == null) return "—";
  const hours = seconds / 3600;
  if (hours < 1) return `${Math.round(seconds / 60)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function timeAgo(unixSeconds: number | null): string {
  if (!unixSeconds) return "—";
  const ms = unixSeconds > 1e12 ? unixSeconds : unixSeconds * 1000;
  const diffMin = Math.max(0, Math.floor((Date.now() - ms) / 60000));
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

interface Props {
  address: string | null;
  label?: string | null;
  onClose: () => void;
}

export default function WalletProfileSlideOver({ address, label, onClose }: Props) {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<WalletProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!address) return;
    setProfile(null);
    setError(false);
    setLoading(true);
    apiRequest<WalletProfile>("GET", `/roster/${address}/profile`)
      .then(setProfile)
      .catch((err) => {
        if (err instanceof ApiError) setError(true);
      })
      .finally(() => setLoading(false));
  }, [address]);

  if (!address) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full sm:w-[70%] max-w-2xl h-full bg-kira-surface border-l border-kira-border overflow-y-auto">
        <div className="sticky top-0 bg-kira-surface border-b border-kira-border px-5 py-4 flex items-center justify-between">
          <div>
            <div className="text-kira-text text-sm font-medium">{label ?? "Wallet Profile"}</div>
            <div className="flex items-center gap-2 mt-1">
              <span className="font-data text-xs text-kira-text-muted">{truncate(address)}</span>
              <button
                onClick={() => navigator.clipboard.writeText(address)}
                className="text-xs text-kira-accent hover:underline"
              >
                Copy
              </button>
              <a
                href={`https://solscan.io/account/${address}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-kira-accent hover:underline"
              >
                View on Solscan
              </a>
            </div>
          </div>
          <button onClick={onClose} className="text-kira-text-muted hover:text-kira-text text-lg leading-none px-2">
            ×
          </button>
        </div>

        {loading && (
          <div className="p-5 space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 bg-kira-surface-2 rounded animate-pulse" />
            ))}
          </div>
        )}

        {!loading && error && (
          <div className="p-8 text-center text-kira-text-muted text-sm">Profile data unavailable</div>
        )}

        {!loading && profile && (
          <div className="p-5 space-y-6">
            <section>
              <h3 className="text-xs text-kira-text-muted uppercase tracking-wide mb-3">Performance</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-kira-surface-2 rounded p-3">
                  <div className="text-kira-text-dim text-xs">Win Rate</div>
                  <div className="text-kira-text text-sm font-data mt-1">
                    {profile.stats.winRate != null ? `${Math.round(profile.stats.winRate * 100)}%` : "—"}
                  </div>
                </div>
                <div className="bg-kira-surface-2 rounded p-3">
                  <div className="text-kira-text-dim text-xs">Realized PnL</div>
                  <div className={`text-sm font-data mt-1 ${pctClass(profile.stats.realizedProfit)}`}>
                    {fmtUsd(profile.stats.realizedProfit)}
                  </div>
                </div>
                <div className="bg-kira-surface-2 rounded p-3">
                  <div className="text-kira-text-dim text-xs">Trades</div>
                  <div className="text-kira-text text-sm font-data mt-1">{profile.stats.totalTrades}</div>
                </div>
                <div className="bg-kira-surface-2 rounded p-3">
                  <div className="text-kira-text-dim text-xs">Avg Hold</div>
                  <div className="text-kira-text text-sm font-data mt-1">
                    {fmtHold(profile.stats.avgHoldingPeriodSeconds)}
                  </div>
                </div>
              </div>
              {profile.stats.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-3">
                  {profile.stats.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-[10px] px-2 py-0.5 rounded border border-kira-border text-kira-text-muted"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h3 className="text-xs text-kira-text-muted uppercase tracking-wide mb-3">Current Holdings</h3>
              {profile.holdings.length === 0 ? (
                <p className="text-kira-text-dim text-xs">No holdings found.</p>
              ) : (
                <div className="space-y-2">
                  {profile.holdings.map((h) => (
                    <div
                      key={h.tokenAddress ?? h.symbol}
                      className="flex items-center justify-between bg-kira-surface-2 rounded px-3 py-2 cursor-pointer hover:bg-kira-surface-2/70"
                      onClick={() => h.tokenAddress && navigate(`/token/${h.tokenAddress}`)}
                    >
                      <span className="text-kira-text text-xs">${h.symbol ?? "—"}</span>
                      <span className="text-kira-text-muted text-xs font-data">{fmtUsd(h.usdValue)}</span>
                      <span className={`text-xs font-data ${pctClass(h.realizedProfitPnl)}`}>
                        {fmtPct(h.realizedProfitPnl)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h3 className="text-xs text-kira-text-muted uppercase tracking-wide mb-3">Recent Activity</h3>
              {profile.recentActivity.length === 0 ? (
                <p className="text-kira-text-dim text-xs">No recent activity.</p>
              ) : (
                <div className="space-y-2">
                  {profile.recentActivity.map((a) => (
                    <div
                      key={a.txHash ?? `${a.tokenAddress}-${a.timestamp}`}
                      className="flex items-center justify-between bg-kira-surface-2 rounded px-3 py-2 cursor-pointer hover:bg-kira-surface-2/70"
                      onClick={() => a.tokenAddress && navigate(`/token/${a.tokenAddress}`)}
                    >
                      <span className={`text-xs uppercase font-medium ${a.side === "buy" ? "text-kira-green" : "text-kira-red"}`}>
                        {a.side}
                      </span>
                      <span className="text-kira-text text-xs">${a.symbol ?? "—"}</span>
                      <span className="text-kira-text-muted text-xs font-data">{fmtUsd(a.usdValue)}</span>
                      <span className="text-kira-text-dim text-xs">{timeAgo(a.timestamp)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
