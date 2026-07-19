import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Bell } from "lucide-react";
import { apiRequest, ApiError } from "../lib/api.js";
import { useAppData } from "../shell/AppDataContext.js";

interface KolSourceStats {
  id: string;
  platform: string;
  displayName: string | null;
  channelIdentifier: string;
  active: boolean;
  totalCalls: number;
  winRate24h: number | null;
  winRate7d: number | null;
  avgReturn24h: number | null;
  lastCallAt: string | null;
}

interface KolCall {
  id: string;
  sourceId: string;
  sourceType: "telegram" | "gmgn_kol" | "twitter";
  tokenAddress: string;
  calledAt: string;
  priceAtCall: number | null;
  return1h: number | null;
  return4h: number | null;
  return24h: number | null;
  return7d: number | null;
}

interface UserKolSource {
  id: string;
  platform: string;
  channelIdentifier: string;
  displayName: string | null;
  active: boolean;
  addedAt: string;
  totalCalls: number;
  lastCallAt: string | null;
}

const USER_KOL_SOURCE_LIMITS: Record<string, number> = { scout: 3, pro: 20, elite: Infinity, studio: Infinity };

function truncate(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function pct(v: number | null): string {
  return v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function pctClass(v: number | null): string {
  if (v == null) return "text-tt-fg-faint";
  return v >= 0 ? "text-tt-green" : "text-tt-red";
}

function winRateClass(v: number | null): string {
  if (v == null) return "text-tt-fg-faint";
  return v >= 0.5 ? "text-tt-green" : "text-tt-red";
}

/** Personal sources have no ingestion path yet (Sprint 9's KOL ingestion item builds that),
 * so a user's own channels always show 0 calls / no win rate today -- not a bug in this page,
 * just the real state of the data until that ships. */
function MySources({ tier }: { tier: string }) {
  const [sources, setSources] = useState<UserKolSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [handle, setHandle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    apiRequest<{ sources: UserKolSource[] }>("GET", "/kol/user-sources")
      .then((res) => setSources(res.sources))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const limit = USER_KOL_SOURCE_LIMITS[tier] ?? 3;

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    const trimmed = handle.trim();
    if (!trimmed) return;
    setFormError(null);
    setSubmitting(true);
    try {
      await apiRequest("POST", "/kol/user-sources", { channelIdentifier: trimmed });
      setHandle("");
      load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setFormError("Personal source limit reached for your tier. Upgrade to add more.");
      } else if (err instanceof ApiError && err.status === 409) {
        setFormError("That channel is already in your sources.");
      } else if (err instanceof ApiError && err.status === 400) {
        setFormError("Enter a valid Telegram @handle.");
      } else {
        setFormError("Couldn't add that channel.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove(id: string) {
    await apiRequest("DELETE", `/kol/user-sources/${id}`);
    setSources((prev) => prev.filter((s) => s.id !== id));
  }

  return (
    <div>
      <div className="bg-tt-bg-raised border border-tt-border rounded-md p-4 mb-6">
        <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-2">
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="@channel"
            className="flex-1 bg-transparent border border-tt-border rounded-md px-3 py-2.5 text-xs font-body text-tt-fg placeholder:text-tt-fg-faint focus:outline-none focus:border-tt-brand"
          />
          <button
            type="submit"
            disabled={submitting || (limit !== Infinity && sources.length >= limit)}
            className="border border-tt-brand text-tt-brand font-body text-xs uppercase tracking-wide px-4 py-2.5 rounded-md hover:bg-tt-brand hover:text-tt-bg transition-colors disabled:opacity-50"
          >
            Add
          </button>
        </form>
        {formError && <p className="text-xs text-tt-red mt-2">{formError}</p>}
        <p className="text-[10px] text-tt-fg-faint mt-2">
          {sources.length} of {limit === Infinity ? "unlimited" : limit} personal sources used ({tier})
        </p>
      </div>

      {loading ? (
        <div className="text-tt-fg-dim text-sm">Loading...</div>
      ) : sources.length === 0 ? (
        <div className="bg-tt-bg-raised border border-tt-border rounded-md p-8 text-center">
          <p className="text-tt-fg text-sm">No personal channels added yet.</p>
          <p className="text-tt-fg-dim text-xs mt-1">Add a Telegram channel handle above to track it here.</p>
        </div>
      ) : (
        <div className="bg-tt-bg-raised border border-tt-border rounded-md overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-tt-fg-faint border-b border-tt-border">
                <th className="px-4 py-3 font-normal">Channel</th>
                <th className="px-4 py-3 font-normal">Calls</th>
                <th className="px-4 py-3 font-normal">Last Call</th>
                <th className="px-4 py-3 font-normal">Added</th>
                <th className="px-4 py-3 font-normal"></th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id} className="border-b border-tt-border last:border-0">
                  <td className="px-4 py-3 text-tt-fg">{s.displayName ?? `@${s.channelIdentifier}`}</td>
                  <td className="px-4 py-3 font-body text-xs text-tt-fg-dim">{s.totalCalls}</td>
                  <td className="px-4 py-3 text-tt-fg-faint text-xs">
                    {s.lastCallAt ? new Date(s.lastCallAt).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-3 text-tt-fg-faint text-xs">{new Date(s.addedAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => void handleRemove(s.id)} className="text-tt-red text-xs hover:underline">
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

interface ConsensusToken {
  tokenAddress: string;
  sourceCount: number;
  firstCallAt: string;
  priceAtFirstCall: number | null;
  return24h: number | null;
  return7d: number | null;
}

/** "Call History" surfaces consensus calls -- tokens 2+ sources agreed on -- not the raw
 * per-channel feed. Grouped client-side from the existing /kol/calls data (curated channels +
 * GMGN KOL feed, the only calls that exist today; personal-source calls don't exist until the
 * ingestion work ships), so this needs no new backend route. */
function CallHistory() {
  const [calls, setCalls] = useState<KolCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [minSources, setMinSources] = useState(2);

  useEffect(() => {
    setLoading(true);
    apiRequest<{ calls: KolCall[] }>("GET", "/kol/calls")
      .then((res) => setCalls(res.calls))
      .finally(() => setLoading(false));
  }, []);

  const consensusTokens = useMemo<ConsensusToken[]>(() => {
    const byToken = new Map<string, KolCall[]>();
    for (const c of calls) {
      const list = byToken.get(c.tokenAddress) ?? [];
      list.push(c);
      byToken.set(c.tokenAddress, list);
    }

    const rows: ConsensusToken[] = [];
    for (const [tokenAddress, tokenCalls] of byToken) {
      const distinctSources = new Set(tokenCalls.map((c) => (c.sourceType === "gmgn_kol" ? "gmgn_kol" : c.sourceId)));
      if (distinctSources.size < minSources) continue;

      const sorted = [...tokenCalls].sort((a, b) => new Date(a.calledAt).getTime() - new Date(b.calledAt).getTime());
      const first = sorted[0];
      rows.push({
        tokenAddress,
        sourceCount: distinctSources.size,
        firstCallAt: first.calledAt,
        priceAtFirstCall: first.priceAtCall,
        return24h: first.return24h,
        return7d: first.return7d,
      });
    }

    return rows.sort((a, b) => b.sourceCount - a.sourceCount);
  }, [calls, minSources]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-tt-fg-dim">Min sources:</span>
        {[2, 3, 5].map((n) => (
          <button
            key={n}
            onClick={() => setMinSources(n)}
            className={`text-xs px-2.5 py-1 rounded-md border ${
              minSources === n ? "border-tt-brand text-tt-brand" : "border-tt-border text-tt-fg-dim"
            }`}
          >
            {n}+
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-tt-fg-dim text-sm">Loading...</div>
      ) : consensusTokens.length === 0 ? (
        <div className="bg-tt-bg-raised border border-tt-border rounded-md p-8 text-center text-tt-fg-dim text-sm">
          No tokens called by {minSources}+ sources yet.
        </div>
      ) : (
        <div className="bg-tt-bg-raised border border-tt-border rounded-md overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-tt-fg-faint border-b border-tt-border">
                <th className="px-4 py-3 font-normal">Token</th>
                <th className="px-4 py-3 font-normal">Called By</th>
                <th className="px-4 py-3 font-normal">First Call</th>
                <th className="px-4 py-3 font-normal">Price at Call</th>
                <th className="px-4 py-3 font-normal">+24h%</th>
                <th className="px-4 py-3 font-normal">+7d%</th>
                <th className="px-4 py-3 font-normal"></th>
              </tr>
            </thead>
            <tbody>
              {consensusTokens.map((t) => (
                <tr key={t.tokenAddress} className="border-b border-tt-border last:border-0">
                  <td className="px-4 py-3 font-body text-xs text-tt-fg">{truncate(t.tokenAddress)}</td>
                  <td className="px-4 py-3 text-tt-brand text-xs">{t.sourceCount} sources</td>
                  <td className="px-4 py-3 text-tt-fg-faint text-xs">{new Date(t.firstCallAt).toLocaleString()}</td>
                  <td className="px-4 py-3 font-body text-xs text-tt-fg-dim">
                    {t.priceAtFirstCall != null ? `$${t.priceAtFirstCall}` : "—"}
                  </td>
                  <td className={`px-4 py-3 font-body text-xs ${pctClass(t.return24h)}`}>{pct(t.return24h)}</td>
                  <td className={`px-4 py-3 font-body text-xs ${pctClass(t.return7d)}`}>{pct(t.return7d)}</td>
                  <td className="px-4 py-3">
                    <Link to={`/token/${t.tokenAddress}`} className="text-tt-brand text-xs hover:underline">
                      DD
                    </Link>
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

const ALERT_OPTIONS = ["New Call", "Call Update", "Win/Loss Result"];

interface RowPrefs {
  bubbles: boolean;
  toast: boolean;
  alertTypes: Set<string>;
  sound: "Silent" | "Chime" | "Alert Tone";
}

function defaultPrefs(): RowPrefs {
  return { bubbles: true, toast: true, alertTypes: new Set(ALERT_OPTIONS), sound: "Silent" };
}

/** Per-row notification prefs (Chart Bubbles/Toast/Alerts/Sound), borrowed from the Trojan
 * wallet-tracker interaction pattern per the redesign guide. Local UI state only -- the mockup's
 * own version has no backend behind these either, and wiring real per-source notification
 * delivery is a backend feature this design-only sprint isn't building. */
function LeaderboardRow({ source, prefs, onChange }: { source: KolSourceStats; prefs: RowPrefs; onChange: (p: RowPrefs) => void }) {
  const [ddOpen, setDdOpen] = useState(false);

  function toggleAlertType(opt: string) {
    const next = new Set(prefs.alertTypes);
    if (next.has(opt)) next.delete(opt);
    else next.add(opt);
    onChange({ ...prefs, alertTypes: next });
  }

  return (
    <tr className="border-b border-tt-border last:border-0">
      <td className="px-4 py-3 text-tt-fg">{source.displayName ?? source.channelIdentifier}</td>
      <td className="px-4 py-3 text-[#6FA8DC] text-xs capitalize">{source.platform}</td>
      <td className="px-4 py-3 font-body text-xs text-tt-fg-dim">{source.totalCalls}</td>
      <td className={`px-4 py-3 font-body text-xs ${winRateClass(source.winRate24h)}`}>
        {source.winRate24h != null ? `${Math.round(source.winRate24h * 100)}%` : "—"}
      </td>
      <td className={`px-4 py-3 font-body text-xs ${winRateClass(source.winRate7d)}`}>
        {source.winRate7d != null ? `${Math.round(source.winRate7d * 100)}%` : "—"}
      </td>
      <td className={`px-4 py-3 font-body text-xs ${pctClass(source.avgReturn24h)}`}>{pct(source.avgReturn24h)}</td>
      <td className="px-4 py-3">
        <span
          onClick={() => onChange({ ...prefs, bubbles: !prefs.bubbles })}
          className={`inline-block px-3 py-1 text-[10px] rounded-md border cursor-pointer text-center min-w-[34px] ${
            prefs.bubbles ? "border-tt-brand text-tt-brand" : "border-tt-border text-tt-fg-faint"
          }`}
        >
          {prefs.bubbles ? "On" : "Off"}
        </span>
      </td>
      <td className="px-4 py-3">
        <span
          onClick={() => onChange({ ...prefs, toast: !prefs.toast })}
          className={`inline-block px-3 py-1 text-[10px] rounded-md border cursor-pointer text-center min-w-[34px] ${
            prefs.toast ? "border-tt-brand text-tt-brand" : "border-tt-border text-tt-fg-faint"
          }`}
        >
          {prefs.toast ? "On" : "Off"}
        </span>
      </td>
      <td className="px-4 py-3 relative">
        <button
          onClick={() => setDdOpen((o) => !o)}
          className="border border-tt-border text-tt-fg-dim text-xs px-3 py-1.5 rounded-md flex items-center gap-2"
        >
          {prefs.alertTypes.size === ALERT_OPTIONS.length ? "All Actions" : `${prefs.alertTypes.size} selected`} ▾
        </button>
        {ddOpen && (
          <div className="absolute top-full left-0 mt-1 z-20 bg-tt-bg-raised border border-tt-border rounded-md min-w-[160px]">
            {ALERT_OPTIONS.map((opt) => (
              <div
                key={opt}
                onClick={() => toggleAlertType(opt)}
                className="flex justify-between px-3 py-2 text-xs text-tt-fg-dim hover:bg-tt-bg hover:text-tt-fg cursor-pointer"
              >
                <span>{opt}</span>
                {prefs.alertTypes.has(opt) && <span className="text-tt-green">✓</span>}
              </div>
            ))}
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        <select
          value={prefs.sound}
          onChange={(e) => onChange({ ...prefs, sound: e.target.value as RowPrefs["sound"] })}
          className="bg-transparent border border-tt-border text-tt-fg-faint text-xs px-2 py-1.5 rounded-md"
        >
          <option>Silent</option>
          <option>Chime</option>
          <option>Alert Tone</option>
        </select>
      </td>
    </tr>
  );
}

function Leaderboard({
  curatedSources,
  personalSources,
  includeKira,
}: {
  curatedSources: KolSourceStats[];
  personalSources: UserKolSource[];
  includeKira: boolean;
}) {
  const [prefsById, setPrefsById] = useState<Record<string, RowPrefs>>({});

  // Sprint 10 Bug 5: curated-source prefs now persist server-side (kira_kol_notification_prefs
  // scopes source_id to kira_kol_sources only, per the migration). Personal-source rows keep the
  // pre-existing local-only behavior -- there's no FK target for them in this table.
  useEffect(() => {
    apiRequest<{ prefs: Array<{ sourceId: string; chartBubbles: boolean; toast: boolean; alertTypes: string[] }> }>(
      "GET",
      "/kol/prefs",
    )
      .then((res) => {
        const loaded: Record<string, RowPrefs> = {};
        for (const p of res.prefs) {
          loaded[p.sourceId] = {
            bubbles: p.chartBubbles,
            toast: p.toast,
            alertTypes: new Set(p.alertTypes),
            sound: "Silent",
          };
        }
        setPrefsById((prev) => ({ ...loaded, ...prev }));
      })
      .catch(() => {});
  }, []);

  function prefsFor(id: string): RowPrefs {
    return prefsById[id] ?? defaultPrefs();
  }

  function persistPrefs(sourceId: string, prefs: RowPrefs) {
    void apiRequest("POST", `/kol/prefs/${sourceId}`, {
      chart_bubbles: prefs.bubbles,
      toast: prefs.toast,
      alert_types: Array.from(prefs.alertTypes),
    }).catch(() => {});
  }

  const personalAsStats: KolSourceStats[] = personalSources.map((s) => ({
    id: s.id,
    platform: s.platform,
    displayName: s.displayName,
    channelIdentifier: s.channelIdentifier,
    active: s.active,
    totalCalls: s.totalCalls,
    winRate24h: null,
    winRate7d: null,
    avgReturn24h: null,
    lastCallAt: s.lastCallAt,
  }));

  function renderTable(rows: KolSourceStats[], persist: boolean) {
    return (
      <div className="bg-tt-bg-raised border border-tt-border rounded-md overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-tt-fg-faint border-b border-tt-border">
              <th className="px-4 py-3 font-normal">Channel</th>
              <th className="px-4 py-3 font-normal">Platform</th>
              <th className="px-4 py-3 font-normal">Total Calls</th>
              <th className="px-4 py-3 font-normal">Win Rate 24h</th>
              <th className="px-4 py-3 font-normal">Win Rate 7d</th>
              <th className="px-4 py-3 font-normal">Avg Return 24h</th>
              <th className="px-4 py-3 font-normal">Chart Bubbles</th>
              <th className="px-4 py-3 font-normal">Toast</th>
              <th className="px-4 py-3 font-normal">Alerts</th>
              <th className="px-4 py-3 font-normal">Sound</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <LeaderboardRow
                key={s.id}
                source={s}
                prefs={prefsFor(s.id)}
                onChange={(p) => {
                  setPrefsById((prev) => ({ ...prev, [s.id]: p }));
                  if (persist) persistPrefs(s.id, p);
                }}
              />
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {personalAsStats.length === 0 ? (
        <div className="bg-tt-bg-raised border border-tt-border rounded-md p-8 text-center text-tt-fg-dim text-sm">
          No personal sources yet. Add channels from the My Sources tab.
        </div>
      ) : (
        renderTable(personalAsStats, false)
      )}

      {includeKira && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-tt-fg-faint mb-2">Kira Tracked Channels</div>
          {renderTable(curatedSources, true)}
        </div>
      )}
    </div>
  );
}

function WarmingUp() {
  return (
    <div className="bg-tt-bg-raised border border-tt-border rounded-md p-8 text-center">
      <p className="text-tt-fg text-sm">KOL tracker is warming up.</p>
      <p className="text-tt-fg-dim text-xs mt-1">
        Historical data is being collected from 10 channels.
        <br />
        Check back in 24-48 hours for accuracy scores.
      </p>
    </div>
  );
}

type Tab = "mysources" | "history" | "leaderboard";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "mysources", label: "My Sources" },
  { id: "history", label: "Call History" },
  { id: "leaderboard", label: "Leaderboard" },
];

export default function KolPage() {
  const { me } = useAppData();
  const [tab, setTab] = useState<Tab>("mysources");
  const [curatedSources, setCuratedSources] = useState<KolSourceStats[]>([]);
  const [personalSources, setPersonalSources] = useState<UserKolSource[]>([]);
  const [warmingUp, setWarmingUp] = useState(false);
  const [loading, setLoading] = useState(true);
  const [includeKira, setIncludeKira] = useState(false);
  const [recentCalls, setRecentCalls] = useState<KolCall[]>([]);
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  const newCallsLast24h = recentCalls.length;

  useEffect(() => {
    apiRequest<{ calls: KolCall[] }>("GET", "/kol/calls")
      .then((res) => {
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        setRecentCalls(res.calls.filter((c) => new Date(c.calledAt).getTime() >= cutoff));
      })
      .catch(() => setRecentCalls([]));
  }, []);

  // Contextual bell: this page's bell shows/opens KOL calls (kira_kol_calls), not the global
  // kira_alerts feed the TopBar bell shows -- KOL calls aren't alerts and never will be, so the
  // global bell showing them here would just be wrong, not merely inconsistent styling.
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    Promise.all([
      apiRequest<{ sources: KolSourceStats[]; totalCalls: number; warmingUp: boolean }>("GET", "/kol/sources"),
      apiRequest<{ sources: UserKolSource[] }>("GET", "/kol/user-sources"),
    ])
      .then(([curated, personal]) => {
        setCuratedSources(curated.sources);
        setWarmingUp(curated.warmingUp);
        setPersonalSources(personal.sources);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <h1 className="font-display uppercase text-lg text-tt-fg">KOL Tracker</h1>
          <div className="relative" ref={bellRef}>
            <button onClick={() => setBellOpen((o) => !o)} className="relative text-tt-fg-dim hover:text-tt-fg">
              <Bell size={16} />
              {newCallsLast24h > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-tt-red text-tt-bg text-[10px] leading-none rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                  {newCallsLast24h > 99 ? "99+" : newCallsLast24h}
                </span>
              )}
            </button>
            {bellOpen && (
              <div className="absolute left-0 top-full mt-2 w-80 bg-tt-bg-raised border border-tt-border rounded-md z-30 max-h-96 overflow-y-auto">
                <div className="px-4 py-2.5 border-b border-tt-border text-[10px] uppercase tracking-wide text-tt-fg-faint">
                  KOL Calls · Last 24h
                </div>
                {recentCalls.length === 0 ? (
                  <div className="px-4 py-6 text-center text-xs text-tt-fg-faint">No new calls in the last 24h.</div>
                ) : (
                  recentCalls.slice(0, 10).map((c) => (
                    <Link
                      key={c.id}
                      to={`/token/${c.tokenAddress}`}
                      onClick={() => setBellOpen(false)}
                      className="block px-4 py-2.5 border-b border-tt-border last:border-0 cursor-pointer hover:bg-tt-bg-panel"
                    >
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-tt-fg-dim">{c.sourceType === "gmgn_kol" ? "GMGN KOL" : c.sourceType === "twitter" ? "Twitter" : "Telegram"}</span>
                        <span className="text-tt-fg-faint text-[10px]">{new Date(c.calledAt).toLocaleTimeString()}</span>
                      </div>
                      <div className="text-tt-fg text-xs font-data">{truncate(c.tokenAddress)}</div>
                    </Link>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-tt-fg-dim cursor-pointer">
          Include Kira's Channels
          <span
            onClick={() => setIncludeKira((v) => !v)}
            className={`inline-block px-3 py-1 text-[10px] rounded-md border ${
              includeKira ? "border-tt-brand text-tt-brand" : "border-tt-border text-tt-fg-faint"
            }`}
          >
            {includeKira ? "On" : "Off"}
          </span>
        </label>
      </div>

      <div className="flex gap-1 mb-4">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`text-xs px-3 py-1.5 rounded-md border ${
              tab === t.id ? "border-tt-brand text-tt-brand" : "border-tt-border text-tt-fg-dim"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "mysources" && <MySources tier={me?.tier ?? "scout"} />}
      {tab === "history" && <CallHistory />}
      {tab === "leaderboard" &&
        (loading ? (
          <div className="text-tt-fg-dim text-sm">Loading...</div>
        ) : warmingUp && includeKira ? (
          <WarmingUp />
        ) : (
          <Leaderboard curatedSources={curatedSources} personalSources={personalSources} includeKira={includeKira} />
        ))}
    </div>
  );
}
