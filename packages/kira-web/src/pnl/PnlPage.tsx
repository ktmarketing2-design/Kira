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
  if (v == null) return "text-kira-text-dim";
  return v >= 0 ? "text-kira-green" : "text-kira-red";
}

function truncate(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
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

  const tier = me?.tier ?? "scout";
  const limit = TIER_LIMITS[tier] ?? 1;

  return (
    <div>
      <h1 className="font-display text-lg text-kira-text mb-4">PnL</h1>

      <div className="flex gap-1 mb-4">
        {(["overview", "history", "wallets"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-xs px-3 py-1.5 rounded border capitalize ${tab === t ? "border-kira-accent text-kira-accent" : "border-kira-border text-kira-text-muted"}`}
          >
            {t === "wallets" ? "By Wallet" : t}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-kira-text-muted text-sm">Loading...</div>
      ) : wallets.length === 0 ? (
        <div className="bg-kira-surface border border-kira-border rounded-md p-8 text-center text-kira-text-muted text-sm mb-4">
          No wallets tracked for PnL yet. Add one below to get a daily digest.
        </div>
      ) : null}

      {tab === "overview" && wallets.length > 0 && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-kira-surface border border-kira-border rounded-md p-3">
              <div className="text-xs text-kira-text-dim">Realized PnL</div>
              <div className={`font-data text-sm ${pctClass(totals.realized)}`}>{fmtUsd(totals.realized)}</div>
            </div>
            <div className="bg-kira-surface border border-kira-border rounded-md p-3">
              <div className="text-xs text-kira-text-dim">Unrealized PnL</div>
              <div className={`font-data text-sm ${pctClass(totals.unrealized)}`}>{fmtUsd(totals.unrealized)}</div>
            </div>
            <div className="bg-kira-surface border border-kira-border rounded-md p-3">
              <div className="text-xs text-kira-text-dim">Trades</div>
              <div className="font-data text-sm text-kira-text">{totals.trades}</div>
            </div>
            <div className="bg-kira-surface border border-kira-border rounded-md p-3">
              <div className="text-xs text-kira-text-dim">Win Rate</div>
              <div className="font-data text-sm text-kira-text">
                {totals.winRate != null ? `${Math.round(totals.winRate * 100)}%` : "—"}
              </div>
            </div>
          </div>

          <div className="bg-kira-surface border border-kira-border rounded-md p-4">
            <h2 className="text-xs uppercase tracking-wide text-kira-text-muted mb-3">Top Performers</h2>
            {topPerformers.length === 0 ? (
              <p className="text-xs text-kira-text-dim">No data yet.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {topPerformers.map((s) => (
                  <li key={s.id} className="flex justify-between">
                    <span className="text-kira-text-muted">
                      {s.top_gainer_symbol?.slice(0, 4)}... on {s.date}
                    </span>
                    <span className={pctClass(s.top_gainer_pct)}>
                      {s.top_gainer_pct != null ? `+${s.top_gainer_pct.toFixed(0)}%` : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {tab === "history" && (
        <div className="bg-kira-surface border border-kira-border rounded-md overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-kira-text-muted border-b border-kira-border">
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
                <tr key={s.id} className="border-b border-kira-border last:border-0">
                  <td className="px-4 py-3 text-kira-text-dim text-xs">{s.date}</td>
                  <td className="px-4 py-3 font-data text-xs text-kira-text-muted">{truncate(s.wallet_address)}</td>
                  <td className={`px-4 py-3 font-data text-xs ${pctClass(s.realized_pnl_usd)}`}>{fmtUsd(s.realized_pnl_usd)}</td>
                  <td className={`px-4 py-3 font-data text-xs ${pctClass(s.unrealized_pnl_usd)}`}>{fmtUsd(s.unrealized_pnl_usd)}</td>
                  <td className="px-4 py-3 font-data text-xs text-kira-text-muted">
                    {s.winning_trades ?? 0}/{s.total_trades ?? 0}
                  </td>
                  <td className="px-4 py-3 text-xs text-kira-green">
                    {s.top_gainer_symbol ? `${s.top_gainer_symbol.slice(0, 4)}... +${(s.top_gainer_pct ?? 0).toFixed(0)}%` : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-kira-red">
                    {s.top_loser_symbol ? `${s.top_loser_symbol.slice(0, 4)}... ${(s.top_loser_pct ?? 0).toFixed(0)}%` : "—"}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-kira-text-muted text-sm">
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
          <div className="bg-kira-surface border border-kira-border rounded-md p-4 mb-4">
            <form onSubmit={handleAddWallet} className="flex flex-col sm:flex-row gap-2">
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Wallet address"
                className="flex-1 bg-kira-surface-2 border border-kira-border rounded px-3 py-2 text-xs font-data text-kira-text placeholder:text-kira-text-dim focus:outline-none focus:border-kira-accent"
              />
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Label (optional)"
                className="sm:w-40 bg-kira-surface-2 border border-kira-border rounded px-3 py-2 text-xs text-kira-text placeholder:text-kira-text-dim focus:outline-none focus:border-kira-accent"
              />
              <button type="submit" className="bg-kira-accent text-kira-bg rounded px-4 py-2 text-sm font-medium">
                Add
              </button>
            </form>
            {formError && <p className="text-xs text-kira-red mt-2">{formError}</p>}
            <p className="text-xs text-kira-text-dim mt-2">
              {wallets.length} of {limit === Infinity ? "unlimited" : limit} wallets used ({tier})
            </p>
          </div>

          <div className="space-y-2">
            {wallets.map((w) => (
              <div key={w.id} className="bg-kira-surface border border-kira-border rounded-md p-3 flex items-center justify-between">
                <div>
                  <span className="text-sm text-kira-text">{w.label || truncate(w.address)}</span>
                  <span className="font-data text-xs text-kira-text-dim ml-2">{truncate(w.address)}</span>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => setWalletFilter(w.address)} className="text-xs text-kira-accent hover:underline">
                    View history
                  </button>
                  <button onClick={() => void handleRemove(w.address)} className="text-xs text-kira-red hover:underline">
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
