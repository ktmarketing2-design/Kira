import { useEffect, useMemo, useState, type FormEvent } from "react";
import { apiRequest, ApiError } from "../lib/api.js";
import { useAppData } from "../shell/AppDataContext.js";

const TIER_LIMITS: Record<string, number> = { scout: 1, pro: 5, elite: Infinity, studio: Infinity };
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

interface PnlWallet {
  id: string;
  address: string;
  label: string | null;
}

interface PnlSnapshot {
  id: string;
  wallet_address: string;
  date: string;
  realized_pnl_usd: number | null;
  unrealized_pnl_usd: number | null;
  total_trades: number | null;
  winning_trades: number | null;
  top_gainer_symbol: string | null;
  top_gainer_pct: number | null;
  top_loser_symbol: string | null;
  top_loser_pct: number | null;
}

function fmtUsd(v: number | null): string {
  if (v == null) return "—";
  const sign = v >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function pctClass(v: number | null): string {
  if (v == null) return "text-tt-fg-faint";
  return v >= 0 ? "text-tt-green" : "text-tt-red";
}

function truncate(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function CumulativePnlChart({ snapshots }: { snapshots: PnlSnapshot[] }) {
  const byDate = new Map<string, number>();
  for (const s of snapshots) {
    byDate.set(s.date, (byDate.get(s.date) ?? 0) + (s.realized_pnl_usd ?? 0));
  }
  const dates = [...byDate.keys()].sort();
  if (dates.length === 0) {
    return <div className="text-xs text-tt-fg-faint py-8 text-center">No PnL history yet.</div>;
  }

  let running = 0;
  const points = dates.map((d) => {
    running += byDate.get(d) ?? 0;
    return running;
  });

  const w = 900;
  const h = 100;
  const pad = 6;
  const min = Math.min(0, ...points);
  const max = Math.max(0, ...points);
  const range = max - min || 1;
  const x = (i: number) => pad + (i / Math.max(1, points.length - 1)) * (w - pad * 2);
  const y = (v: number) => h - pad - ((v - min) / range) * (h - pad * 2);
  const d = points.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ");
  const zeroY = y(0);
  const color = points[points.length - 1] >= 0 ? "#4AF626" : "#FF3B3B";

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} className="block">
      <line x1={0} x2={w} y1={zeroY} y2={zeroY} stroke="#262624" strokeDasharray="3,3" />
      <path d={d} stroke={color} strokeWidth={1.5} fill="none" />
    </svg>
  );
}

export default function PnlPage() {
  const { me } = useAppData();
  const [tab, setTab] = useState<"overview" | "history" | "wallets">("overview");
  const [wallets, setWallets] = useState<PnlWallet[]>([]);
  const [snapshots, setSnapshots] = useState<PnlSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [walletFilter, setWalletFilter] = useState("");

  function load() {
    setLoading(true);
    Promise.all([
      apiRequest<{ wallets: PnlWallet[] }>("GET", "/pnl/wallets"),
      apiRequest<{ snapshots: PnlSnapshot[] }>("GET", "/pnl/snapshots"),
    ])
      .then(([w, s]) => {
        setWallets(w.wallets);
        setSnapshots(s.snapshots);
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleAddWallet(e: FormEvent) {
    e.preventDefault();
    if (!SOLANA_ADDRESS_RE.test(address.trim())) {
      setFormError("Enter a valid Solana wallet address.");
      return;
    }
    setFormError(null);
    try {
      await apiRequest("POST", "/pnl/wallets", { address: address.trim(), label: label.trim() || undefined });
      setAddress("");
      setLabel("");
      load();
    } catch (err) {
      setFormError(
        err instanceof ApiError && err.status === 403 ? "PnL wallet limit reached for your tier." : "Couldn't add that wallet.",
      );
    }
  }

  async function handleRemove(addr: string) {
    await apiRequest("DELETE", `/pnl/wallets/${addr}`);
    setWallets((prev) => prev.filter((w) => w.address !== addr));
  }

  const filtered = walletFilter ? snapshots.filter((s) => s.wallet_address === walletFilter) : snapshots;

  const totals = useMemo(() => {
    const realized = filtered.reduce((sum, s) => sum + (s.realized_pnl_usd ?? 0), 0);
    const unrealized = filtered.reduce((sum, s) => sum + (s.unrealized_pnl_usd ?? 0), 0);
    const trades = filtered.reduce((sum, s) => sum + (s.total_trades ?? 0), 0);
    const wins = filtered.reduce((sum, s) => sum + (s.winning_trades ?? 0), 0);
    return { realized, unrealized, trades, winRate: trades > 0 ? wins / trades : null };
  }, [filtered]);

  const topPerformers = useMemo(() => {
    return [...filtered]
      .filter((s) => s.top_gainer_pct != null)
      .sort((a, b) => (b.top_gainer_pct ?? 0) - (a.top_gainer_pct ?? 0))
      .slice(0, 5);
  }, [filtered]);

  const walletStats = useMemo(() => {
    return wallets.map((w) => {
      const rows = snapshots.filter((s) => s.wallet_address === w.address);
      const realized = rows.reduce((sum, s) => sum + (s.realized_pnl_usd ?? 0), 0);
      const unrealized = rows.reduce((sum, s) => sum + (s.unrealized_pnl_usd ?? 0), 0);
      const trades = rows.reduce((sum, s) => sum + (s.total_trades ?? 0), 0);
      const wins = rows.reduce((sum, s) => sum + (s.winning_trades ?? 0), 0);
      return { wallet: w, realized, unrealized, trades, winRate: trades > 0 ? wins / trades : null };
    });
  }, [wallets, snapshots]);

  const tier = me?.tier ?? "scout";
  const limit = TIER_LIMITS[tier] ?? 1;

  return (
    <div>
      <h1 className="font-display uppercase text-lg text-tt-fg mb-1">PnL</h1>

      <div className="flex gap-1 mb-4 mt-3">
        {(["overview", "history", "wallets"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-xs px-4 py-2 rounded-md border capitalize ${tab === t ? "border-tt-brand text-tt-brand" : "border-tt-border text-tt-fg-dim"}`}
          >
            {t === "wallets" ? "By Wallet" : t}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-tt-fg-dim text-sm">Loading...</div>
      ) : wallets.length === 0 ? (
        <div className="bg-tt-bg-raised border border-tt-border rounded-md p-8 text-center text-tt-fg-dim text-sm mb-4">
          No wallets tracked for PnL yet. Add one below to get a daily digest.
        </div>
      ) : null}

      {tab === "overview" && wallets.length > 0 && (
        <div>
          <div className="bg-tt-bg-raised border border-tt-border rounded-md p-6 mb-5">
            <div className="flex justify-between items-start mb-5">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-tt-fg-faint mb-1.5">
                  Total PnL (Realized + Unrealized)
                </div>
                <div className={`font-display text-3xl ${pctClass(totals.realized + totals.unrealized)}`}>
                  {fmtUsd(totals.realized + totals.unrealized)}
                </div>
                <div className="text-[10px] text-tt-fg-faint mt-1">All tracked wallets</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wide text-tt-fg-faint mb-1.5">Win Rate</div>
                <div className="font-display text-xl text-tt-fg">
                  {totals.winRate != null ? `${Math.round(totals.winRate * 100)}%` : "—"}
                </div>
              </div>
            </div>
            <CumulativePnlChart snapshots={filtered} />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-tt-border border border-tt-border rounded-md overflow-hidden mb-5">
            <div className="bg-tt-bg p-4">
              <div className="text-[10px] uppercase tracking-wide text-tt-fg-faint mb-2">Realized PnL</div>
              <div className={`font-display text-lg ${pctClass(totals.realized)}`}>{fmtUsd(totals.realized)}</div>
            </div>
            <div className="bg-tt-bg p-4">
              <div className="text-[10px] uppercase tracking-wide text-tt-fg-faint mb-2">Unrealized PnL</div>
              <div className={`font-display text-lg ${pctClass(totals.unrealized)}`}>{fmtUsd(totals.unrealized)}</div>
            </div>
            <div className="bg-tt-bg p-4">
              <div className="text-[10px] uppercase tracking-wide text-tt-fg-faint mb-2">Trades</div>
              <div className="font-display text-lg text-tt-fg">{totals.trades}</div>
            </div>
            <div className="bg-tt-bg p-4">
              <div className="text-[10px] uppercase tracking-wide text-tt-fg-faint mb-2">Win Rate</div>
              <div className="font-display text-lg text-tt-fg">
                {totals.winRate != null ? `${Math.round(totals.winRate * 100)}%` : "—"}
              </div>
            </div>
          </div>

          <div className="bg-tt-bg-raised border border-tt-border rounded-md p-5">
            <div className="text-[10px] uppercase tracking-wide text-tt-fg-faint mb-3">Top Performers</div>
            {topPerformers.length === 0 ? (
              <p className="text-xs text-tt-fg-faint">No data yet.</p>
            ) : (
              topPerformers.map((s) => (
                <div key={s.id} className="flex justify-between text-xs py-2 border-t border-tt-border first:border-t-0">
                  <span className="text-tt-fg">
                    {s.top_gainer_symbol?.slice(0, 4)}...
                    <span className="text-tt-fg-faint text-[10px] ml-2">on {s.date}</span>
                  </span>
                  <span className={pctClass(s.top_gainer_pct)}>
                    {s.top_gainer_pct != null ? `+${s.top_gainer_pct.toFixed(0)}%` : "—"}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {tab === "history" && (
        <div className="bg-tt-bg-raised border border-tt-border rounded-md overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-tt-fg-faint border-b border-tt-border">
                <th className="px-4 py-3 font-normal">Date</th>
                <th className="px-4 py-3 font-normal">Wallet</th>
                <th className="px-4 py-3 font-normal">Realized</th>
                <th className="px-4 py-3 font-normal">Unrealized</th>
                <th className="px-4 py-3 font-normal">Trades</th>
                <th className="px-4 py-3 font-normal">Best</th>
                <th className="px-4 py-3 font-normal">Worst</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id} className="border-b border-tt-border last:border-0">
                  <td className="px-4 py-3 text-tt-fg-faint text-xs">{s.date}</td>
                  <td className="px-4 py-3 font-body text-xs text-tt-fg-dim">{truncate(s.wallet_address)}</td>
                  <td className={`px-4 py-3 font-body text-xs ${pctClass(s.realized_pnl_usd)}`}>{fmtUsd(s.realized_pnl_usd)}</td>
                  <td className={`px-4 py-3 font-body text-xs ${pctClass(s.unrealized_pnl_usd)}`}>{fmtUsd(s.unrealized_pnl_usd)}</td>
                  <td className="px-4 py-3 font-body text-xs text-tt-fg-dim">
                    {s.winning_trades ?? 0}/{s.total_trades ?? 0}
                  </td>
                  <td className="px-4 py-3 text-xs text-tt-green">
                    {s.top_gainer_symbol ? `${s.top_gainer_symbol.slice(0, 4)}... +${(s.top_gainer_pct ?? 0).toFixed(0)}%` : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-tt-red">
                    {s.top_loser_symbol ? `${s.top_loser_symbol.slice(0, 4)}... ${(s.top_loser_pct ?? 0).toFixed(0)}%` : "—"}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-tt-fg-dim text-sm">
                    No PnL history yet, check back after tomorrow's digest.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "wallets" && (
        <div>
          <div className="bg-tt-bg-raised border border-tt-border rounded-md p-4 mb-5">
            <form onSubmit={handleAddWallet} className="flex flex-col sm:flex-row gap-2">
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Wallet address"
                className="flex-1 bg-transparent border border-tt-border rounded-md px-3 py-2.5 text-xs font-body text-tt-fg placeholder:text-tt-fg-faint focus:outline-none focus:border-tt-brand"
              />
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Label (optional)"
                className="sm:w-40 bg-transparent border border-tt-border rounded-md px-3 py-2.5 text-xs text-tt-fg placeholder:text-tt-fg-faint focus:outline-none focus:border-tt-brand"
              />
              <button
                type="submit"
                className="border border-tt-brand text-tt-brand font-body text-xs uppercase tracking-wide px-4 py-2.5 rounded-md hover:bg-tt-brand hover:text-tt-bg transition-colors"
              >
                Add
              </button>
            </form>
            {formError && <p className="text-xs text-tt-red mt-2">{formError}</p>}
            <p className="text-[10px] text-tt-fg-faint mt-2">
              {wallets.length} of {limit === Infinity ? "unlimited" : limit} wallets used ({tier})
            </p>
          </div>

          <div className="space-y-3">
            {walletStats.map(({ wallet: w, realized, unrealized, trades, winRate }) => (
              <div key={w.id} className="bg-tt-bg-raised border border-tt-border rounded-md p-5">
                <div className="flex justify-between mb-3">
                  <span className="text-tt-fg text-sm">{w.label || truncate(w.address)}</span>
                  <span className="text-tt-fg-faint text-[10px]">{w.label ? truncate(w.address) : "Tracked wallet"}</span>
                </div>
                <div className="flex gap-7 mb-3">
                  <div>
                    <div className="text-[10px] text-tt-fg-faint mb-1">PnL</div>
                    <div className={`text-sm ${pctClass(realized + unrealized)}`}>{fmtUsd(realized + unrealized)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-tt-fg-faint mb-1">Trades</div>
                    <div className="text-sm text-tt-fg">{trades}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-tt-fg-faint mb-1">Win Rate</div>
                    <div className="text-sm text-tt-fg">{winRate != null ? `${Math.round(winRate * 100)}%` : "—"}</div>
                  </div>
                </div>
                <div className="flex gap-4 text-xs">
                  <button onClick={() => setWalletFilter(w.address)} className="text-tt-brand hover:underline">
                    View history
                  </button>
                  <button onClick={() => void handleRemove(w.address)} className="text-tt-red hover:underline">
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
