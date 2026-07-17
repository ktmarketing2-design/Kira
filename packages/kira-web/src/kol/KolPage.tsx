import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "../lib/api.js";

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
  sourceType: "telegram" | "gmgn_kol";
  tokenAddress: string;
  calledAt: string;
  priceAtCall: number | null;
  return1h: number | null;
  return4h: number | null;
  return24h: number | null;
  return7d: number | null;
}

function truncate(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function pct(v: number | null): string {
  return v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function pctClass(v: number | null): string {
  if (v == null) return "text-kira-text-dim";
  return v >= 0 ? "text-kira-green" : "text-kira-red";
}

function WarmingUp() {
  return (
    <div className="bg-kira-surface border border-kira-border rounded-md p-8 text-center">
      <p className="text-kira-text text-sm">KOL tracker is warming up.</p>
      <p className="text-kira-text-muted text-xs mt-1">
        Historical data is being collected from 10 channels.
        <br />
        Check back in 24-48 hours for accuracy scores.
      </p>
    </div>
  );
}

function Leaderboard({ sources }: { sources: KolSourceStats[] }) {
  return (
    <div className="bg-kira-surface border border-kira-border rounded-md overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-kira-text-muted border-b border-kira-border">
            <th className="px-4 py-3 font-normal">Channel</th>
            <th className="px-4 py-3 font-normal">Platform</th>
            <th className="px-4 py-3 font-normal">Total Calls</th>
            <th className="px-4 py-3 font-normal">Win Rate 24h</th>
            <th className="px-4 py-3 font-normal">Win Rate 7d</th>
            <th className="px-4 py-3 font-normal">Avg Return 24h</th>
            <th className="px-4 py-3 font-normal">Last Call</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((s) => (
            <tr key={s.id} className="border-b border-kira-border last:border-0">
              <td className="px-4 py-3 text-kira-text">{s.displayName ?? s.channelIdentifier}</td>
              <td className="px-4 py-3 text-kira-text-muted capitalize">{s.platform}</td>
              <td className="px-4 py-3 font-data text-xs text-kira-text-muted">{s.totalCalls}</td>
              <td className="px-4 py-3 font-data text-xs text-kira-text-muted">
                {s.winRate24h != null ? `${Math.round(s.winRate24h * 100)}%` : "—"}
              </td>
              <td className="px-4 py-3 font-data text-xs text-kira-text-muted">
                {s.winRate7d != null ? `${Math.round(s.winRate7d * 100)}%` : "—"}
              </td>
              <td className={`px-4 py-3 font-data text-xs ${pctClass(s.avgReturn24h)}`}>{pct(s.avgReturn24h)}</td>
              <td className="px-4 py-3 text-kira-text-dim text-xs">
                {s.lastCallAt ? new Date(s.lastCallAt).toLocaleDateString() : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CallHistory({ sources }: { sources: KolSourceStats[] }) {
  const [calls, setCalls] = useState<KolCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [sourceFilter, setSourceFilter] = useState("");
  const [sourceTypeFilter, setSourceTypeFilter] = useState<"" | "telegram" | "gmgn_kol">("");
  const [minReturn, setMinReturn] = useState("");
  const [sortKey, setSortKey] = useState<keyof KolCall>("calledAt");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);

  function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (sourceFilter) params.set("source", sourceFilter);
    if (sourceTypeFilter) params.set("sourceType", sourceTypeFilter);
    if (minReturn) params.set("minReturn", minReturn);
    apiRequest<{ calls: KolCall[] }>("GET", `/kol/calls?${params.toString()}`)
      .then((res) => setCalls(res.calls))
      .finally(() => setLoading(false));
  }

  useEffect(load, [sourceFilter, sourceTypeFilter, minReturn]);

  const sourceName = (call: KolCall) =>
    call.sourceType === "gmgn_kol" ? "GMGN KOL" : sources.find((s) => s.id === call.sourceId)?.displayName ?? "Unknown";

  function sortBy(key: keyof KolCall) {
    if (sortKey === key) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setSortDir(-1);
    }
  }

  const sorted = [...calls].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (av == null) return 1;
    if (bv == null) return -1;
    return av > bv ? sortDir : av < bv ? -sortDir : 0;
  });

  const columns: Array<{ key: keyof KolCall; label: string }> = [
    { key: "calledAt", label: "Called At" },
    { key: "priceAtCall", label: "Price at Call" },
    { key: "return1h", label: "+1h%" },
    { key: "return4h", label: "+4h%" },
    { key: "return24h", label: "+24h%" },
    { key: "return7d", label: "+7d%" },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex gap-1">
          {(["", "telegram", "gmgn_kol"] as const).map((v) => (
            <button
              key={v || "all"}
              onClick={() => setSourceTypeFilter(v)}
              className={`text-xs px-2 py-1 rounded border ${
                sourceTypeFilter === v ? "border-kira-accent text-kira-accent" : "border-kira-border text-kira-text-muted"
              }`}
            >
              {v === "" ? "All" : v === "telegram" ? "Telegram" : "GMGN"}
            </button>
          ))}
        </div>
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="bg-kira-surface-2 border border-kira-border rounded px-2 py-1 text-xs text-kira-text"
        >
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.displayName ?? s.channelIdentifier}
            </option>
          ))}
        </select>
        <input
          type="number"
          placeholder="Min 24h return %"
          value={minReturn}
          onChange={(e) => setMinReturn(e.target.value)}
          className="bg-kira-surface-2 border border-kira-border rounded px-2 py-1 text-xs text-kira-text w-40"
        />
      </div>

      {loading ? (
        <div className="text-kira-text-muted text-sm">Loading...</div>
      ) : sorted.length === 0 ? (
        <div className="bg-kira-surface border border-kira-border rounded-md p-8 text-center text-kira-text-muted text-sm">
          No calls recorded yet.
        </div>
      ) : (
        <div className="bg-kira-surface border border-kira-border rounded-md overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-kira-text-muted border-b border-kira-border">
                <th className="px-4 py-3 font-normal">Source</th>
                <th className="px-4 py-3 font-normal">Token</th>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    onClick={() => sortBy(c.key)}
                    className="px-4 py-3 font-normal cursor-pointer hover:text-kira-text"
                  >
                    {c.label} {sortKey === c.key ? (sortDir === 1 ? "↑" : "↓") : ""}
                  </th>
                ))}
                <th className="px-4 py-3 font-normal"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => (
                <tr key={c.id} className="border-b border-kira-border last:border-0">
                  <td className="px-4 py-3 text-kira-text-muted">{sourceName(c)}</td>
                  <td className="px-4 py-3 font-data text-xs text-kira-text">{truncate(c.tokenAddress)}</td>
                  <td className="px-4 py-3 text-kira-text-dim text-xs">{new Date(c.calledAt).toLocaleString()}</td>
                  <td className="px-4 py-3 font-data text-xs text-kira-text-muted">
                    {c.priceAtCall != null ? `$${c.priceAtCall}` : "—"}
                  </td>
                  <td className={`px-4 py-3 font-data text-xs ${pctClass(c.return1h)}`}>{pct(c.return1h)}</td>
                  <td className={`px-4 py-3 font-data text-xs ${pctClass(c.return4h)}`}>{pct(c.return4h)}</td>
                  <td className={`px-4 py-3 font-data text-xs ${pctClass(c.return24h)}`}>{pct(c.return24h)}</td>
                  <td className={`px-4 py-3 font-data text-xs ${pctClass(c.return7d)}`}>{pct(c.return7d)}</td>
                  <td className="px-4 py-3">
                    <Link to={`/token/${c.tokenAddress}`} className="text-kira-accent text-xs hover:underline">
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

export default function KolPage() {
  const [tab, setTab] = useState<"leaderboard" | "history">("leaderboard");
  const [sources, setSources] = useState<KolSourceStats[]>([]);
  const [warmingUp, setWarmingUp] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRequest<{ sources: KolSourceStats[]; totalCalls: number; warmingUp: boolean }>("GET", "/kol/sources")
      .then((res) => {
        setSources(res.sources);
        setWarmingUp(res.warmingUp);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1 className="font-display text-lg text-kira-text mb-4">KOL Tracker</h1>

      <div className="flex gap-1 mb-4">
        <button
          onClick={() => setTab("leaderboard")}
          className={`text-xs px-3 py-1.5 rounded border ${tab === "leaderboard" ? "border-kira-accent text-kira-accent" : "border-kira-border text-kira-text-muted"}`}
        >
          Leaderboard
        </button>
        <button
          onClick={() => setTab("history")}
          className={`text-xs px-3 py-1.5 rounded border ${tab === "history" ? "border-kira-accent text-kira-accent" : "border-kira-border text-kira-text-muted"}`}
        >
          Call History
        </button>
      </div>

      {loading ? (
        <div className="text-kira-text-muted text-sm">Loading...</div>
      ) : warmingUp ? (
        <WarmingUp />
      ) : tab === "leaderboard" ? (
        <Leaderboard sources={sources} />
      ) : (
        <CallHistory sources={sources} />
      )}
    </div>
  );
}
