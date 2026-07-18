import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Bell } from "lucide-react";
import { apiRequest, ApiError } from "../lib/api.js";
import { useAppData } from "../shell/AppDataContext.js";
import FilterForm, { type FilterFormValues } from "./FilterForm.js";
import type { SignalFilter, Alert } from "../lib/types.js";

const TIER_LIMITS: Record<string, number> = { scout: 1, pro: 5, elite: Infinity, studio: Infinity };

interface MatchAlert extends Alert {
  filter_id?: string | null;
}

interface Chip {
  label: string;
  value: string;
}

function criteriaChips(f: SignalFilter): Chip[] {
  const chips: Chip[] = [];
  if (f.min_liquidity_usd != null) chips.push({ label: "Liquidity", value: `≥ $${f.min_liquidity_usd.toLocaleString("en-US")}` });
  if (f.max_fdv_usd != null) chips.push({ label: "FDV", value: `≤ $${f.max_fdv_usd.toLocaleString("en-US")}` });
  if (f.min_volume_24h != null) chips.push({ label: "24h Vol", value: `≥ $${f.min_volume_24h.toLocaleString("en-US")}` });
  if (f.min_holders != null) chips.push({ label: "Holders", value: `≥ ${f.min_holders}` });
  if (f.max_age_hours != null) chips.push({ label: "Age", value: `≤ ${f.max_age_hours}h` });
  if (f.min_rug_score != null) chips.push({ label: "Rug Score", value: `≥ ${f.min_rug_score}` });
  if (f.min_volume_score != null) chips.push({ label: "Vol Score", value: `≥ ${f.min_volume_score}` });
  if (f.launchpads?.length) chips.push({ label: "Launchpad", value: f.launchpads.join(" / ") });
  if (f.require_lp_locked) chips.push({ label: "LP", value: "locked" });
  if (f.require_mint_revoked) chips.push({ label: "Mint", value: "revoked" });
  if (f.require_roster_wallet) chips.push({ label: "Cluster size", value: `≥ ${f.min_roster_wallets} wallets` });
  return chips;
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function FiltersPage() {
  const { me, liveAlerts } = useAppData();
  const [filters, setFilters] = useState<SignalFilter[]>([]);
  const [matches, setMatches] = useState<MatchAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SignalFilter | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    Promise.all([
      apiRequest<{ filters: SignalFilter[] }>("GET", "/signal-filters"),
      apiRequest<{ alerts: MatchAlert[] }>("GET", "/alerts?type=signal_filter_match"),
    ])
      .then(([filtersRes, alertsRes]) => {
        setFilters(filtersRes.filters);
        setMatches(alertsRes.alerts);
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleSubmit(values: FilterFormValues) {
    setSubmitting(true);
    setError(null);
    try {
      if (editing) {
        await apiRequest("PATCH", `/signal-filters/${editing.id}`, values);
      } else {
        await apiRequest("POST", "/signal-filters", values);
      }
      setFormOpen(false);
      setEditing(undefined);
      load();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 403
          ? "Active filter limit reached for your tier."
          : "Couldn't save that filter.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggle(filter: SignalFilter) {
    try {
      await apiRequest("PATCH", `/signal-filters/${filter.id}/toggle`);
      load();
    } catch {
      setError("Couldn't toggle that filter.");
    }
  }

  async function handleDelete(filter: SignalFilter) {
    try {
      await apiRequest("DELETE", `/signal-filters/${filter.id}`);
      setFilters((prev) => prev.filter((f) => f.id !== filter.id));
    } catch {
      setError("Couldn't delete that filter.");
    }
  }

  const tier = me?.tier ?? "scout";
  const limit = TIER_LIMITS[tier] ?? 1;
  const activeCount = filters.filter((f) => f.active).length;
  const atCapacity = limit !== Infinity && activeCount >= limit;

  // Contextual bell: scoped to signal_filter_match only, not the full liveAlerts feed the TopBar
  // bell shows -- a user watching this page cares about their filter matches, not cluster buys.
  const filterMatchAlerts = liveAlerts.filter((a) => a.type === "signal_filter_match");
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2.5">
          <h1 className="font-display uppercase text-lg text-tt-fg">Signal Filters</h1>
          <div className="relative" ref={bellRef}>
            <button onClick={() => setBellOpen((o) => !o)} className="relative text-tt-fg-dim hover:text-tt-fg">
              <Bell size={16} />
              {filterMatchAlerts.length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-tt-red text-tt-bg text-[10px] leading-none rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                  {filterMatchAlerts.length > 99 ? "99+" : filterMatchAlerts.length}
                </span>
              )}
            </button>
            {bellOpen && (
              <div className="absolute left-0 top-full mt-2 w-80 bg-tt-bg-raised border border-tt-border rounded-md z-30 max-h-96 overflow-y-auto">
                <div className="px-4 py-2.5 border-b border-tt-border text-[10px] uppercase tracking-wide text-tt-fg-faint">
                  Signal Filter Matches
                </div>
                {filterMatchAlerts.length === 0 ? (
                  <div className="px-4 py-6 text-center text-xs text-tt-fg-faint">No filter matches yet.</div>
                ) : (
                  filterMatchAlerts.slice(0, 10).map((a) => (
                    <Link
                      key={a.id}
                      to={`/token/${a.token_address}`}
                      onClick={() => setBellOpen(false)}
                      className="block px-4 py-2.5 border-b border-tt-border last:border-0 cursor-pointer hover:bg-tt-bg-panel"
                    >
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-tt-fg-dim">${a.token_symbol ?? "?"}</span>
                        <span className="text-tt-fg-faint text-[10px]">{new Date(a.created_at).toLocaleTimeString()}</span>
                      </div>
                    </Link>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
        {!formOpen && (
          <button
            onClick={() => {
              setEditing(undefined);
              setFormOpen(true);
            }}
            className="border border-tt-brand text-tt-brand font-body text-xs uppercase tracking-wide px-4 py-2.5 rounded-md hover:bg-tt-brand hover:text-tt-bg transition-colors"
          >
            + New Filter
          </button>
        )}
      </div>

      <p className="text-[10px] text-tt-fg-faint mb-4">
        {activeCount} of {limit === Infinity ? "unlimited" : limit} active filters used ({tier})
      </p>

      {error && <p className="text-xs text-tt-red mb-4">{error}</p>}

      {formOpen && (
        <FilterForm
          initial={editing}
          submitting={submitting}
          onCancel={() => {
            setFormOpen(false);
            setEditing(undefined);
          }}
          onSubmit={handleSubmit}
        />
      )}

      {loading ? (
        <div className="text-tt-fg-dim text-sm">Loading...</div>
      ) : filters.length === 0 ? (
        <div className="bg-tt-bg-raised border border-tt-border rounded-md p-8 text-center text-tt-fg-dim text-sm">
          No Signal Filters yet. Create one to get alerted the moment a new token matches your criteria,
          anywhere on Solana, regardless of who's buying.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filters.map((f) => {
            const chips = criteriaChips(f);
            const filterMatches = matches.filter((m) => m.filter_id === f.id).slice(0, 3);
            const lastMatchAt = filterMatches[0]?.created_at;

            return (
              <div
                key={f.id}
                className={`bg-tt-bg-raised border border-tt-border rounded-md p-5 ${f.active ? "" : "opacity-60"}`}
              >
                <div className="flex justify-between items-start mb-3.5">
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${f.active ? "bg-tt-green shadow-[0_0_6px_#4AF626]" : "bg-tt-fg-faint"}`} />
                    <span className="font-display text-sm text-tt-fg">{f.name}</span>
                  </div>
                  <div className="text-right">
                    <div className={`font-display text-base ${f.active ? "text-tt-green" : "text-tt-fg-faint"}`}>
                      {f.matches24h}
                    </div>
                    <div className="text-[9px] text-tt-fg-faint uppercase tracking-wide">Match / 24h</div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5 mb-3.5">
                  {chips.length === 0 ? (
                    <span className="text-[10px] text-tt-fg-faint">No criteria set</span>
                  ) : (
                    chips.map((c) => (
                      <span key={c.label} className="border border-tt-border rounded-md px-2.5 py-1 text-[10px] text-tt-fg-dim">
                        {c.label} <b className="text-tt-fg font-normal">{c.value}</b>
                      </span>
                    ))
                  )}
                </div>

                <div className="flex justify-between text-[10px] text-tt-fg-faint border-t border-tt-border pt-3 mb-3.5">
                  <span>Created {new Date(f.created_at).toLocaleDateString()}</span>
                  <span>
                    {!f.active
                      ? atCapacity
                        ? "Inactive · tier limit"
                        : "Inactive"
                      : lastMatchAt
                        ? `Last match ${timeAgo(lastMatchAt)}`
                        : "No matches yet"}
                  </span>
                </div>

                <div className="mb-3.5">
                  <div className="text-[9px] text-tt-fg-faint uppercase tracking-wide mb-2">Recent Matches</div>
                  {filterMatches.length === 0 ? (
                    <div className="text-[10px] text-tt-fg-faint">No matches yet</div>
                  ) : (
                    filterMatches.map((m) => (
                      <div key={m.id} className="flex justify-between text-xs py-1.5 border-t border-tt-border first:border-t-0">
                        <span className="text-tt-fg">${m.token_symbol ?? "?"}</span>
                        <span className="text-tt-fg-faint text-[10px]">{timeAgo(m.created_at)}</span>
                      </div>
                    ))
                  )}
                </div>

                <div className="flex gap-4 text-xs">
                  <button
                    onClick={() => void handleToggle(f)}
                    className={f.active ? "text-tt-fg-dim hover:text-tt-fg" : "text-tt-green hover:underline"}
                  >
                    {f.active ? "Deactivate" : "Activate"}
                  </button>
                  <button
                    onClick={() => {
                      setEditing(f);
                      setFormOpen(true);
                    }}
                    className="text-[#6FA8DC] hover:underline"
                  >
                    Edit
                  </button>
                  <button onClick={() => void handleDelete(f)} className="text-tt-red hover:underline">
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
