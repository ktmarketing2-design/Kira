import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { apiRequest, ApiError } from "../lib/api.js";
import { useAppData } from "../shell/AppDataContext.js";
import AlertCard from "./AlertCard.js";
import SmartMoneyFeed from "./SmartMoneyFeed.js";
import type { Alert, RosterWallet } from "../lib/types.js";

const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

interface WatchlistToken {
  tokenAddress: string;
  tokenSymbol: string | null;
}

interface TrendingToken {
  address: string;
  symbol: string | null;
  priceChange5mPct: number | null;
}

/** Decorative activity-level preview, same purpose as the mockup's mini-graph: gives the left
 * column something to look at besides an empty alert feed. Not wired to real cluster-event data
 * -- there's no endpoint for "cluster activity over time" today, and inventing one for a sparkline
 * isn't worth a schema/route addition. Static shape, not live. */
function ActivitySparkline() {
  const points = [20, 35, 25, 50, 42, 60, 55, 75, 68, 80, 72, 90, 85, 95];
  const w = 460;
  const h = 130;
  const pad = 10;
  const max = Math.max(...points);
  const x = (i: number) => pad + (i / (points.length - 1)) * (w - pad * 2);
  const y = (v: number) => h - pad - (v / max) * (h - pad * 2);
  const d = points.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ");
  const fillD = `${d} L${x(points.length - 1)},${h} L${x(0)},${h} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="130" className="block">
      <path d={fillD} fill="#4AF626" fillOpacity={0.06} />
      <path d={d} stroke="#4AF626" strokeWidth={1.5} fill="none" />
    </svg>
  );
}

export default function DashboardPage() {
  const { liveAlerts, me } = useAppData();
  const [recentAlerts, setRecentAlerts] = useState<Alert[]>([]);
  const [walletsTracked, setWalletsTracked] = useState<number | null>(null);
  const [loadingFeed, setLoadingFeed] = useState(true);
  const [query, setQuery] = useState("");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [watchlist, setWatchlist] = useState<WatchlistToken[]>([]);
  const [movers, setMovers] = useState<TrendingToken[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    apiRequest<{ alerts: Alert[] }>("GET", "/alerts")
      .then((res) => setRecentAlerts(res.alerts))
      .catch(() => setRecentAlerts([]))
      .finally(() => setLoadingFeed(false));

    apiRequest<{ wallets: RosterWallet[] }>("GET", "/roster")
      .then((res) => setWalletsTracked(res.wallets.length))
      .catch(() => setWalletsTracked(null));

    apiRequest<{ tokens: WatchlistToken[] }>("GET", "/watchlist")
      .then((res) => setWatchlist(res.tokens.slice(0, 3)))
      .catch(() => setWatchlist([]));

    apiRequest<{ tokens: TrendingToken[] }>("GET", "/trending/ticker")
      .then((res) => setMovers(res.tokens.slice(0, 4)))
      .catch(() => setMovers([]));
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
    <div>
      <div className="mb-1">
        <h1 className="font-display uppercase text-lg text-tt-fg">Dashboard</h1>
        <div className="text-[10px] text-tt-fg-faint">Overview · {(me?.tier ?? "scout").charAt(0).toUpperCase() + (me?.tier ?? "scout").slice(1)} Tier</div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-tt-border border border-tt-border rounded-md overflow-hidden my-5">
        <div className="bg-tt-bg p-4">
          <div className="text-[10px] text-tt-fg-faint uppercase tracking-wide mb-2">Today's Alerts</div>
          <div className="font-display text-xl text-tt-fg">{todaysAlerts}</div>
        </div>
        <div className="bg-tt-bg p-4">
          <div className="text-[10px] text-tt-fg-faint uppercase tracking-wide mb-2">Wallets Tracked</div>
          <div className="font-display text-xl text-tt-green">{walletsTracked ?? "—"}</div>
        </div>
        <div className="bg-tt-bg p-4">
          <div className="text-[10px] text-tt-fg-faint uppercase tracking-wide mb-2">Tokens DD'd</div>
          <div className="font-display text-sm text-tt-fg-faint">Not tracked yet</div>
        </div>
        <div className="bg-tt-bg p-4">
          <div className="text-[10px] text-tt-fg-faint uppercase tracking-wide mb-2">Vol Authenticity Avg</div>
          <div className="font-display text-sm text-tt-fg-faint">Not tracked yet</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-6">
        <section className="bg-tt-bg-raised border border-tt-border rounded-md p-5">
          <div className="flex justify-between text-[10px] uppercase tracking-wide text-tt-fg-faint mb-3.5">
            <span>Live Alert Feed</span>
            <span className="text-tt-green">● LIVE</span>
          </div>
          {loadingFeed ? (
            <div className="text-tt-fg-dim text-xs">Loading...</div>
          ) : feed.length === 0 ? (
            <div className="text-center py-10 text-tt-fg-dim">
              <p className="text-tt-fg text-sm mb-1.5">No alerts yet.</p>
              <p className="text-xs">Add wallets to your roster to start receiving cluster alerts.</p>
              <a href="/roster" className="inline-block mt-2 text-tt-green text-sm hover:underline">
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

          <div className="flex justify-between text-[10px] uppercase tracking-wide text-tt-fg-faint mt-5 mb-3.5">
            <span>Recent Cluster Activity</span>
            <span>Preview</span>
          </div>
          <ActivitySparkline />
        </section>

        <section className="space-y-4">
          <div className="bg-tt-bg-raised border border-tt-border rounded-md p-4">
            <h2 className="text-[10px] uppercase tracking-wide text-tt-fg-faint mb-3">Token Search</h2>
            <form onSubmit={handleSearch} className="flex gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Solana token address"
                className="flex-1 bg-transparent border border-tt-border rounded-md px-3 py-2.5 text-xs font-body text-tt-fg placeholder:text-tt-fg-faint focus:outline-none focus:border-tt-brand"
              />
              <button
                type="submit"
                disabled={searching}
                className="bg-tt-brand text-tt-bg rounded-md px-3 py-2 disabled:opacity-50"
              >
                <Search size={16} />
              </button>
            </form>
            {searchError && <p className="text-xs text-tt-red mt-2">{searchError}</p>}
            {me?.tier === "scout" && (
              <p className="text-[10px] text-tt-fg-faint mt-2">Scout tier: 10 Deep Dives/day.</p>
            )}
          </div>

          <div className="bg-tt-bg-raised border border-tt-border rounded-md p-4">
            <div className="flex justify-between text-[10px] uppercase tracking-wide text-tt-fg-faint mb-3">
              <span>Watchlist Snapshot</span>
              <span>{watchlist.length} tracked</span>
            </div>
            {watchlist.length === 0 ? (
              <p className="text-[10px] text-tt-fg-faint">Add tokens from Discover to populate this list.</p>
            ) : (
              watchlist.map((t) => (
                <button
                  key={t.tokenAddress}
                  onClick={() => navigate(`/token/${t.tokenAddress}`)}
                  className="w-full flex justify-between py-2 border-t border-tt-border first:border-t-0 text-xs text-left"
                >
                  <span className="text-tt-fg">${t.tokenSymbol ?? "?"}</span>
                  <span className="text-tt-fg-faint">—</span>
                </button>
              ))
            )}
          </div>

          <div className="bg-tt-bg-raised border border-tt-border rounded-md p-4">
            <h2 className="text-[10px] uppercase tracking-wide text-tt-fg-faint mb-3">Top Movers (24h)</h2>
            {movers.length === 0 ? (
              <p className="text-[10px] text-tt-fg-faint">No trending data yet.</p>
            ) : (
              movers.map((t) => {
                const pct = t.priceChange5mPct;
                const up = pct == null || pct >= 0;
                return (
                  <button
                    key={t.address}
                    onClick={() => navigate(`/token/${t.address}`)}
                    className="w-full flex justify-between py-2 border-t border-tt-border first:border-t-0 text-xs text-left"
                  >
                    <span className="text-tt-fg">${t.symbol ?? "?"}</span>
                    <span className={up ? "text-tt-green" : "text-tt-red"}>
                      {pct != null ? `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%` : "—"}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </section>
      </div>

      <div className="mt-6">
        <SmartMoneyFeed />
      </div>
    </div>
  );
}
