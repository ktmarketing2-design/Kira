import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { apiRequest, ApiError } from "../lib/api.js";
import { useAppData } from "../shell/AppDataContext.js";
import AlertCard from "./AlertCard.js";
import type { Alert, RosterWallet } from "../lib/types.js";

const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export default function DashboardPage() {
  const { liveAlerts, me } = useAppData();
  const [recentAlerts, setRecentAlerts] = useState<Alert[]>([]);
  const [walletsTracked, setWalletsTracked] = useState<number | null>(null);
  const [loadingFeed, setLoadingFeed] = useState(true);
  const [query, setQuery] = useState("");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    apiRequest<{ alerts: Alert[] }>("GET", "/alerts")
      .then((res) => setRecentAlerts(res.alerts))
      .catch(() => setRecentAlerts([]))
      .finally(() => setLoadingFeed(false));

    apiRequest<{ wallets: RosterWallet[] }>("GET", "/roster")
      .then((res) => setWalletsTracked(res.wallets.length))
      .catch(() => setWalletsTracked(null));
  }, []);

  const feed = useMemo(() => {
    const byId = new Map<string, Alert>();
    for (const a of [...liveAlerts, ...recentAlerts]) byId.set(a.id, a);
    return Array.from(byId.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  }, [liveAlerts, recentAlerts]);

  const todaysAlerts = useMemo(() => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return feed.filter((a) => new Date(a.created_at) >= startOfDay).length;
  }, [feed]);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const address = query.trim();
    if (!SOLANA_ADDRESS_RE.test(address)) {
      setSearchError("Enter a valid Solana token address.");
      return;
    }
    setSearchError(null);
    setSearching(true);
    try {
      await apiRequest("GET", `/token/${address}/dd`);
      navigate(`/token/${address}`);
    } catch (err) {
      setSearchError(err instanceof ApiError && err.status === 403 ? "Daily Deep Dive limit reached." : "Couldn't generate a Deep Dive for that address.");
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-6">
      <section>
        <h1 className="font-display text-lg text-kira-text mb-4">Live Alert Feed</h1>
        {loadingFeed ? (
          <div className="text-kira-text-muted text-sm">Loading...</div>
        ) : feed.length === 0 ? (
          <div className="bg-kira-surface border border-kira-border rounded-md p-8 text-center">
            <p className="text-kira-text text-sm">No alerts yet.</p>
            <p className="text-kira-text-muted text-xs mt-1">
              Add wallets to your roster to start receiving cluster alerts.
            </p>
            <a href="/roster" className="inline-block mt-3 text-kira-accent text-sm hover:underline">
              Go to Roster →
            </a>
          </div>
        ) : (
          <div className="space-y-3">
            {feed.map((alert) => (
              <AlertCard key={alert.id} alert={alert} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="bg-kira-surface border border-kira-border rounded-md p-4">
          <h2 className="text-xs uppercase tracking-wide text-kira-text-muted mb-3">Quick Stats</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-kira-text-dim text-xs">Today's Alerts</dt>
              <dd className="text-kira-text font-data">{todaysAlerts}</dd>
            </div>
            <div>
              <dt className="text-kira-text-dim text-xs">Wallets Tracked</dt>
              <dd className="text-kira-text font-data">{walletsTracked ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-kira-text-dim text-xs">Tokens DD'd</dt>
              <dd className="text-kira-text-dim font-data text-xs">not tracked yet</dd>
            </div>
            <div>
              <dt className="text-kira-text-dim text-xs">Vol Authenticity Avg</dt>
              <dd className="text-kira-text-dim font-data text-xs">not tracked yet</dd>
            </div>
          </dl>
        </div>

        <div className="bg-kira-surface border border-kira-border rounded-md p-4">
          <h2 className="text-xs uppercase tracking-wide text-kira-text-muted mb-3">Token Search</h2>
          <form onSubmit={handleSearch} className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Solana token address"
              className="flex-1 bg-kira-surface-2 border border-kira-border rounded px-3 py-2 text-xs font-data text-kira-text placeholder:text-kira-text-dim focus:outline-none focus:border-kira-accent"
            />
            <button
              type="submit"
              disabled={searching}
              className="bg-kira-accent text-kira-bg rounded px-3 py-2 disabled:opacity-50"
            >
              <Search size={16} />
            </button>
          </form>
          {searchError && <p className="text-xs text-kira-red mt-2">{searchError}</p>}
          {me?.tier === "scout" && (
            <p className="text-xs text-kira-text-dim mt-2">Scout tier: 10 Deep Dives/day.</p>
          )}
        </div>
      </section>
    </div>
  );
}
