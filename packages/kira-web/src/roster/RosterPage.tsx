import { useEffect, useState, type FormEvent } from "react";
import { apiRequest, ApiError } from "../lib/api.js";
import { useAppData } from "../shell/AppDataContext.js";
import type { RosterWallet } from "../lib/types.js";

const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const TIER_LIMITS: Record<string, number> = { scout: 5, pro: 50, elite: Infinity, studio: Infinity };

function truncate(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export default function RosterPage() {
  const { me } = useAppData();
  const [wallets, setWallets] = useState<RosterWallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function load() {
    setLoading(true);
    apiRequest<{ wallets: RosterWallet[] }>("GET", "/roster")
      .then((res) => setWallets(res.wallets))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!SOLANA_ADDRESS_RE.test(address.trim())) {
      setFormError("Enter a valid Solana wallet address.");
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      await apiRequest("POST", "/roster", { address: address.trim(), label: label.trim() || undefined });
      setAddress("");
      setLabel("");
      load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setFormError("Roster limit reached for your tier. Upgrade to track more wallets.");
      } else if (err instanceof ApiError && err.status === 409) {
        setFormError("That wallet is already in your roster.");
      } else {
        setFormError("Couldn't add that wallet.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove(walletAddress: string) {
    await apiRequest("DELETE", `/roster/${walletAddress}`);
    setWallets((prev) => prev.filter((w) => w.address !== walletAddress));
  }

  const tier = me?.tier ?? "scout";
  const limit = TIER_LIMITS[tier] ?? 5;

  return (
    <div>
      <h1 className="font-display text-lg text-kira-text mb-4">Roster</h1>

      <div className="bg-kira-surface border border-kira-border rounded-md p-4 mb-6">
        <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-2">
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
          <button
            type="submit"
            disabled={submitting}
            className="bg-kira-accent text-kira-bg rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            Add
          </button>
        </form>
        {formError && <p className="text-xs text-kira-red mt-2">{formError}</p>}
        <p className="text-xs text-kira-text-dim mt-2">
          {wallets.length} of {limit === Infinity ? "unlimited" : limit} wallets used ({tier})
        </p>
      </div>

      {loading ? (
        <div className="text-kira-text-muted text-sm">Loading...</div>
      ) : wallets.length === 0 ? (
        <div className="bg-kira-surface border border-kira-border rounded-md p-8 text-center">
          <p className="text-kira-text text-sm">Your roster is empty.</p>
          <p className="text-kira-text-muted text-xs mt-1">
            Add wallet addresses of traders you respect. When 2+ of them buy the same token, you get alerted
            immediately.
          </p>
        </div>
      ) : (
        <div className="bg-kira-surface border border-kira-border rounded-md overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-kira-text-muted border-b border-kira-border">
                <th className="px-4 py-3 font-normal">Address</th>
                <th className="px-4 py-3 font-normal">Label</th>
                <th className="px-4 py-3 font-normal">7d Win Rate</th>
                <th className="px-4 py-3 font-normal">Avg Return</th>
                <th className="px-4 py-3 font-normal">Added</th>
                <th className="px-4 py-3 font-normal"></th>
              </tr>
            </thead>
            <tbody>
              {wallets.map((w) => (
                <tr key={w.id} className="border-b border-kira-border last:border-0">
                  <td className="px-4 py-3 font-data text-xs text-kira-text">{truncate(w.address)}</td>
                  <td className="px-4 py-3 text-kira-text-muted">{w.label ?? "—"}</td>
                  <td className="px-4 py-3 text-kira-text-muted font-data text-xs">
                    {w.performance7d?.win_rate != null ? `${Math.round(w.performance7d.win_rate * 100)}%` : "—"}
                  </td>
                  <td className="px-4 py-3 text-kira-text-muted font-data text-xs">
                    {w.performance7d?.avg_return_pct != null ? `${w.performance7d.avg_return_pct.toFixed(1)}%` : "—"}
                  </td>
                  <td className="px-4 py-3 text-kira-text-dim text-xs">
                    {new Date(w.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => void handleRemove(w.address)}
                      className="text-kira-red text-xs hover:underline"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
