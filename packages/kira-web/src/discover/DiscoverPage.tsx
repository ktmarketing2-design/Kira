import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../lib/api.js";

type DiscoverType = "new_creation" | "near_completion" | "completed";

interface DiscoverToken {
  address: string;
  name: string | null;
  symbol: string | null;
  logo: string | null;
  marketCap: number | null;
  liquidity: number | null;
  holderCount: number | null;
  smartDegenCount: number;
  renownedCount: number;
  sniperCount: number;
  rugRatio: number | null;
  isHoneypot: boolean;
  ratTraderRate: number | null;
  bundlerRate: number | null;
  launchpad: string | null;
  createdAt: number | null;
  isWashTrading: boolean;
}

type SortKey = "smart" | "liquidity" | "holders";

const TYPE_TABS: { value: DiscoverType; label: string }[] = [
  { value: "new_creation", label: "New" },
  { value: "near_completion", label: "Near Graduation" },
  { value: "completed", label: "Graduated" },
];

function age(createdAt: number | null): string {
  if (!createdAt) return "—";
  const ms = createdAt > 1e12 ? createdAt : createdAt * 1000;
  const seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function fmtUsd(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function riskScore(t: DiscoverToken): number {
  // Not a real RugCheck score -- a quick heuristic from Trenches fields alone so the table has
  // something to sort/color by without firing a DD pass for every visible row. Full DD is one
  // click away via the [DD] button.
  let score = 100;
  if (t.isHoneypot) score -= 60;
  if (t.isWashTrading) score -= 20;
  if ((t.ratTraderRate ?? 0) > 0.3) score -= 15;
  if ((t.bundlerRate ?? 0) > 0.2) score -= 15;
  return Math.max(0, score);
}

function riskClass(score: number): string {
  if (score >= 70) return "text-kira-green";
  if (score >= 40) return "text-yellow-400";
  return "text-kira-red";
}

export default function DiscoverPage() {
  const navigate = useNavigate();
  const [type, setType] = useState<DiscoverType>("new_creation");
  const [sortKey, setSortKey] = useState<SortKey>("smart");
  const [tokens, setTokens] = useState<DiscoverToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  function load() {
    apiRequest<{ tokens: DiscoverToken[]; updatedAt: number }>("GET", `/discover?type=${type}`)
      .then((res) => {
        setTokens(res.tokens);
        setUpdatedAt(res.updatedAt);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    setLoading(true);
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  const sorted = [...tokens].sort((a, b) => {
    if (sortKey === "smart") return b.smartDegenCount - a.smartDegenCount;
    if (sortKey === "liquidity") return (b.liquidity ?? 0) - (a.liquidity ?? 0);
    return (b.holderCount ?? 0) - (a.holderCount ?? 0);
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg text-kira-text font-display tracking-wide">Discover — New Tokens</h1>
        {updatedAt && (
          <span className="text-xs text-kira-text-muted">Updated {age(Math.floor(updatedAt / 1000))} ago</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4 mb-3">
        <div className="flex gap-1">
          {TYPE_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setType(tab.value)}
              className={`text-xs px-3 py-1.5 rounded border ${
                type === tab.value
                  ? "border-kira-accent text-kira-accent"
                  : "border-kira-border text-kira-text-muted hover:text-kira-text"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 text-xs text-kira-text-muted">
          Sort:
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="bg-kira-surface-2 border border-kira-border rounded px-2 py-1 text-xs text-kira-text"
          >
            <option value="smart">Smart Money</option>
            <option value="liquidity">Liquidity</option>
            <option value="holders">Holders</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="bg-kira-surface border border-kira-border rounded-md p-8 text-center text-kira-text-muted text-sm">
          Loading...
        </div>
      ) : sorted.length === 0 ? (
        <div className="bg-kira-surface border border-kira-border rounded-md p-8 text-center text-kira-text-muted text-sm">
          No tokens in this bucket right now.
        </div>
      ) : (
        <div className="bg-kira-surface border border-kira-border rounded-md overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-kira-text-muted border-b border-kira-border">
                <th className="px-4 py-3 font-normal">Token</th>
                <th className="px-4 py-3 font-normal">Age</th>
                <th className="px-4 py-3 font-normal">Smart$</th>
                <th className="px-4 py-3 font-normal">KOLs</th>
                <th className="px-4 py-3 font-normal">Risk</th>
                <th className="px-4 py-3 font-normal">Liquidity</th>
                <th className="px-4 py-3 font-normal">Holders</th>
                <th className="px-4 py-3 font-normal">Action</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) => {
                const risk = riskScore(t);
                return (
                  <tr key={t.address} className="border-b border-kira-border last:border-0">
                    <td
                      className="px-4 py-3 text-kira-text cursor-pointer hover:text-kira-accent"
                      onClick={() => navigate(`/token/${t.address}`)}
                    >
                      ${t.symbol ?? t.address.slice(0, 6)}
                    </td>
                    <td className="px-4 py-3 font-data text-xs text-kira-text-muted">{age(t.createdAt)}</td>
                    <td className="px-4 py-3 font-data text-xs text-kira-text-muted">
                      {t.smartDegenCount > 0 ? `🧠${t.smartDegenCount}` : "—"}
                    </td>
                    <td className="px-4 py-3 font-data text-xs text-kira-text-muted">{t.renownedCount || "—"}</td>
                    <td className={`px-4 py-3 font-data text-xs ${riskClass(risk)}`}>{risk}</td>
                    <td className="px-4 py-3 font-data text-xs text-kira-text-muted">{fmtUsd(t.liquidity)}</td>
                    <td className="px-4 py-3 font-data text-xs text-kira-text-muted">{t.holderCount ?? "—"}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => navigate(`/token/${t.address}`)}
                        className="text-xs px-2 py-1 rounded border border-kira-border text-kira-text-muted hover:text-kira-text hover:border-kira-accent"
                      >
                        DD
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
