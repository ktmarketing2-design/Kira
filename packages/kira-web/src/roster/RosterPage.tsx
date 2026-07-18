import { useEffect, useMemo, useState, type FormEvent } from "react";
import { apiRequest, ApiError } from "../lib/api.js";
import { useAppData } from "../shell/AppDataContext.js";
import type { RosterWallet } from "../lib/types.js";
import WalletProfileSlideOver from "./WalletProfileSlideOver.js";

const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const TIER_LIMITS: Record<string, number> = { scout: 5, pro: 50, elite: Infinity, studio: Infinity };

function truncate(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface SmartMoneyWallet {
  address: string;
  label: string | null;
  category: "whale" | "dex_trader" | "early_buyer" | "fund";
  win_rate_30d: number | null;
  avg_return_30d: number | null;
  is_verified: boolean;
  added_at: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  whale: "Whale",
  dex_trader: "DEX Trader",
  early_buyer: "Early Buyer",
  fund: "Fund",
};

function MyRoster({
  wallets,
  loading,
  tier,
  onAdd,
  onRemove,
  onRefresh,
  refreshingAddress,
  refreshError,
  onOpenProfile,
}: {
  wallets: RosterWallet[];
  loading: boolean;
  tier: string;
  onAdd: (address: string, label: string) => Promise<string | null>;
  onRemove: (address: string) => void;
  onRefresh: (address: string) => void;
  refreshingAddress: string | null;
  refreshError: string | null;
  onOpenProfile: (w: RosterWallet) => void;
}) {
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const limit = TIER_LIMITS[tier] ?? 5;
  const canRefreshPerformance = tier === "pro" || tier === "elite";

  const sortedWallets = [...wallets].sort((a, b) => {
    const aRate = a.performance7d?.win_rate ?? -1;
    const bRate = b.performance7d?.win_rate ?? -1;
    return bRate - aRate;
  });

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!SOLANA_ADDRESS_RE.test(address.trim())) {
      setFormError("Enter a valid Solana wallet address.");
      return;
    }
    setFormError(null);
    setSubmitting(true);
    const err = await onAdd(address.trim(), label.trim());
    setSubmitting(false);
    if (err) {
      setFormError(err);
    } else {
      setAddress("");
      setLabel("");
    }
  }

  return (
    <div>
      <div className="bg-tt-bg-raised border border-tt-border rounded-md p-4 mb-6">
        <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2">
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
            disabled={submitting}
            className="border border-tt-brand text-tt-brand font-body text-xs uppercase tracking-wide px-4 py-2.5 rounded-md hover:bg-tt-brand hover:text-tt-bg transition-colors disabled:opacity-50"
          >
            Add
          </button>
        </form>
        {formError && <p className="text-xs text-tt-red mt-2">{formError}</p>}
        <p className="text-[10px] text-tt-fg-faint mt-2">
          {wallets.length} of {limit === Infinity ? "unlimited" : limit} wallets used ({tier})
        </p>
      </div>

      {refreshError && <p className="text-xs text-tt-red mb-2">{refreshError}</p>}

      {loading ? (
        <div className="text-tt-fg-dim text-sm">Loading...</div>
      ) : wallets.length === 0 ? (
        <div className="bg-tt-bg-raised border border-tt-border rounded-md p-8 text-center">
          <p className="text-tt-fg text-sm">Your roster is empty.</p>
          <p className="text-tt-fg-dim text-xs mt-1">
            Add wallet addresses of traders you respect. When 2+ of them buy the same token, you get alerted
            immediately.
          </p>
        </div>
      ) : (
        <div className="bg-tt-bg-raised border border-tt-border rounded-md overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-tt-fg-faint border-b border-tt-border">
                <th className="px-4 py-3 font-normal">Address</th>
                <th className="px-4 py-3 font-normal">Label</th>
                <th className="px-4 py-3 font-normal">7d Win Rate</th>
                <th className="px-4 py-3 font-normal">Avg Return</th>
                <th className="px-4 py-3 font-normal">Last Computed</th>
                <th className="px-4 py-3 font-normal">Added</th>
                <th className="px-4 py-3 font-normal"></th>
              </tr>
            </thead>
            <tbody>
              {sortedWallets.map((w) => (
                <tr
                  key={w.id}
                  className="border-b border-tt-border last:border-0 cursor-pointer hover:bg-tt-bg-panel"
                  onClick={() => onOpenProfile(w)}
                >
                  <td className="px-4 py-3 font-body text-xs text-tt-fg">{truncate(w.address)}</td>
                  <td className="px-4 py-3 text-tt-fg-dim">{w.label ?? "—"}</td>
                  <td className="px-4 py-3 text-tt-fg-dim font-body text-xs">
                    {w.performance7d?.win_rate != null ? `${Math.round(w.performance7d.win_rate * 100)}%` : "—"}
                  </td>
                  <td className="px-4 py-3 text-tt-fg-dim font-body text-xs">
                    {w.performance7d?.avg_return_pct != null ? `${w.performance7d.avg_return_pct.toFixed(1)}%` : "—"}
                  </td>
                  <td className="px-4 py-3 text-tt-fg-faint text-xs">
                    {w.performance7d?.computed_at ? timeAgo(w.performance7d.computed_at) : "—"}
                  </td>
                  <td className="px-4 py-3 text-tt-fg-faint text-xs">{new Date(w.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    {canRefreshPerformance && (
                      <button
                        onClick={() => onRefresh(w.address)}
                        disabled={refreshingAddress === w.address}
                        className="text-tt-brand text-xs hover:underline mr-3 disabled:opacity-50"
                      >
                        {refreshingAddress === w.address ? "Refreshing..." : "Refresh"}
                      </button>
                    )}
                    <button onClick={() => onRemove(w.address)} className="text-tt-red text-xs hover:underline">
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

function SmartMoney({ onOpenProfile }: { onOpenProfile: (address: string, label: string | null) => void }) {
  const [wallets, setWallets] = useState<SmartMoneyWallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<string>("all");
  const [minWinRate, setMinWinRate] = useState(0);
  const [search, setSearch] = useState("");

  useEffect(() => {
    apiRequest<{ wallets: SmartMoneyWallet[] }>("GET", "/smart-money/wallets")
      .then((res) => setWallets(res.wallets))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    return wallets
      .filter((w) => category === "all" || w.category === category)
      .filter((w) => (w.win_rate_30d ?? 0) * 100 >= minWinRate)
      .filter((w) => {
        if (!search.trim()) return true;
        const q = search.trim().toLowerCase();
        return w.address.toLowerCase().includes(q) || (w.label ?? "").toLowerCase().includes(q);
      })
      .sort((a, b) => (b.win_rate_30d ?? 0) - (a.win_rate_30d ?? 0));
  }, [wallets, category, minWinRate, search]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2.5 mb-4">
        {(["all", "whale", "dex_trader", "early_buyer", "fund"] as const).map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={`text-xs px-3 py-1.5 rounded-md border ${
              category === c ? "border-tt-brand text-tt-brand" : "border-tt-border text-tt-fg-dim"
            }`}
          >
            {c === "all" ? "All Categories" : CATEGORY_LABELS[c]}
          </button>
        ))}
        <div className="w-px h-4 bg-tt-border" />
        <label className="flex items-center gap-2 text-xs text-tt-fg-dim">
          Min win rate
          <input
            type="range"
            min={0}
            max={100}
            value={minWinRate}
            onChange={(e) => setMinWinRate(Number(e.target.value))}
            className="w-24"
          />
          <span className="text-tt-fg-faint w-8">{minWinRate}%</span>
        </label>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search wallet..."
          className="ml-auto bg-transparent border border-tt-border rounded-md px-3 py-1.5 text-xs text-tt-fg placeholder:text-tt-fg-faint focus:outline-none focus:border-tt-brand max-w-[240px]"
        />
      </div>

      {loading ? (
        <div className="text-tt-fg-dim text-sm">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-tt-bg-raised border border-tt-border rounded-md p-8 text-center text-tt-fg-dim text-sm">
          No smart money wallets match these filters.
        </div>
      ) : (
        <div className="bg-tt-bg-raised border border-tt-border rounded-md overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-tt-fg-faint border-b border-tt-border">
                <th className="px-4 py-3 font-normal">Wallet</th>
                <th className="px-4 py-3 font-normal">Category</th>
                <th className="px-4 py-3 font-normal">30d Win Rate</th>
                <th className="px-4 py-3 font-normal">Avg Return</th>
                <th className="px-4 py-3 font-normal">Verified</th>
                <th className="px-4 py-3 font-normal">Added</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((w) => (
                <tr
                  key={w.address}
                  className="border-b border-tt-border last:border-0 cursor-pointer hover:bg-tt-bg-panel"
                  onClick={() => onOpenProfile(w.address, w.label)}
                >
                  <td className="px-4 py-3 font-body text-xs text-tt-fg">{w.label ?? truncate(w.address)}</td>
                  <td className="px-4 py-3">
                    <span className="border border-tt-amber text-tt-amber text-[10px] px-2 py-0.5 rounded-md">
                      {CATEGORY_LABELS[w.category] ?? w.category}
                    </span>
                  </td>
                  <td className={`px-4 py-3 font-body text-xs ${(w.win_rate_30d ?? 0) >= 0.5 ? "text-tt-green" : "text-tt-red"}`}>
                    {w.win_rate_30d != null ? `${Math.round(w.win_rate_30d * 100)}%` : "—"}
                  </td>
                  <td className={`px-4 py-3 font-body text-xs ${(w.avg_return_30d ?? 0) >= 0 ? "text-tt-green" : "text-tt-red"}`}>
                    {w.avg_return_30d != null ? `${w.avg_return_30d >= 0 ? "+" : ""}${w.avg_return_30d.toFixed(1)}%` : "—"}
                  </td>
                  <td className="px-4 py-3 text-tt-fg-dim text-xs">{w.is_verified ? "✓" : "—"}</td>
                  <td className="px-4 py-3 text-tt-fg-faint text-xs">{new Date(w.added_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type Tab = "my-roster" | "smart-money";

export default function RosterPage() {
  const { me } = useAppData();
  const [tab, setTab] = useState<Tab>("my-roster");
  const [wallets, setWallets] = useState<RosterWallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshingAddress, setRefreshingAddress] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [profileWallet, setProfileWallet] = useState<{ address: string; label: string | null } | null>(null);

  function load() {
    setLoading(true);
    apiRequest<{ wallets: RosterWallet[] }>("GET", "/roster")
      .then((res) => setWallets(res.wallets))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleAdd(address: string, label: string): Promise<string | null> {
    try {
      await apiRequest("POST", "/roster", { address, label: label || undefined });
      load();
      return null;
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) return "Roster limit reached for your tier. Upgrade to track more wallets.";
      if (err instanceof ApiError && err.status === 409) return "That wallet is already in your roster.";
      return "Couldn't add that wallet.";
    }
  }

  async function handleRemove(walletAddress: string) {
    await apiRequest("DELETE", `/roster/${walletAddress}`);
    setWallets((prev) => prev.filter((w) => w.address !== walletAddress));
  }

  async function handleRefreshPerformance(walletAddress: string) {
    setRefreshError(null);
    setRefreshingAddress(walletAddress);
    try {
      await apiRequest("POST", `/roster/${walletAddress}/refresh-performance`);
    } catch (err) {
      setRefreshError(
        err instanceof ApiError && err.status === 429
          ? "Already refreshed in the last hour."
          : "Couldn't refresh performance for that wallet.",
      );
    } finally {
      setRefreshingAddress(null);
    }
  }

  const tier = me?.tier ?? "scout";

  return (
    <div>
      <h1 className="font-display uppercase text-lg text-tt-fg mb-1">Roster</h1>

      <div className="flex gap-1 mb-4 mt-3">
        <button
          onClick={() => setTab("my-roster")}
          className={`text-xs px-4 py-2 rounded-md border ${tab === "my-roster" ? "border-tt-brand text-tt-brand" : "border-tt-border text-tt-fg-dim"}`}
        >
          My Roster
        </button>
        <button
          onClick={() => setTab("smart-money")}
          className={`text-xs px-4 py-2 rounded-md border ${tab === "smart-money" ? "border-tt-brand text-tt-brand" : "border-tt-border text-tt-fg-dim"}`}
        >
          Smart Money
        </button>
      </div>

      {tab === "my-roster" ? (
        <MyRoster
          wallets={wallets}
          loading={loading}
          tier={tier}
          onAdd={handleAdd}
          onRemove={(a) => void handleRemove(a)}
          onRefresh={(a) => void handleRefreshPerformance(a)}
          refreshingAddress={refreshingAddress}
          refreshError={refreshError}
          onOpenProfile={(w) => setProfileWallet({ address: w.address, label: w.label })}
        />
      ) : (
        <SmartMoney onOpenProfile={(address, label) => setProfileWallet({ address, label })} />
      )}

      <WalletProfileSlideOver
        address={profileWallet?.address ?? null}
        label={profileWallet?.label}
        onClose={() => setProfileWallet(null)}
      />
    </div>
  );
}
