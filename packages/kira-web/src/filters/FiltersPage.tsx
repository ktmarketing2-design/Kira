import { useEffect, useState } from "react";
import { apiRequest, ApiError } from "../lib/api.js";
import { useAppData } from "../shell/AppDataContext.js";
import FilterForm, { type FilterFormValues } from "./FilterForm.js";
import type { SignalFilter } from "../lib/types.js";

const TIER_LIMITS: Record<string, number> = { scout: 1, pro: 5, elite: Infinity, studio: Infinity };

function criteriaSummary(f: SignalFilter): string {
  const bits: string[] = [];
  if (f.min_rug_score != null) bits.push(`rug≥${f.min_rug_score}`);
  if (f.min_liquidity_usd != null) bits.push(`liq≥$${f.min_liquidity_usd.toLocaleString("en-US")}`);
  if (f.max_fdv_usd != null) bits.push(`fdv≤$${f.max_fdv_usd.toLocaleString("en-US")}`);
  if (f.min_volume_24h != null) bits.push(`vol≥$${f.min_volume_24h.toLocaleString("en-US")}`);
  if (f.launchpads?.length) bits.push(f.launchpads.join("/"));
  if (f.require_roster_wallet) bits.push("roster required");
  return bits.length ? bits.join(", ") : "no criteria set";
}

export default function FiltersPage() {
  const { me } = useAppData();
  const [filters, setFilters] = useState<SignalFilter[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SignalFilter | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    apiRequest<{ filters: SignalFilter[] }>("GET", "/signal-filters")
      .then((res) => setFilters(res.filters))
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
    await apiRequest("DELETE", `/signal-filters/${filter.id}`);
    setFilters((prev) => prev.filter((f) => f.id !== filter.id));
  }

  const tier = me?.tier ?? "scout";
  const limit = TIER_LIMITS[tier] ?? 1;
  const activeCount = filters.filter((f) => f.active).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-display text-lg text-kira-text">Signal Filters</h1>
        {!formOpen && (
          <button
            onClick={() => {
              setEditing(undefined);
              setFormOpen(true);
            }}
            className="bg-kira-accent text-kira-bg rounded px-3 py-2 text-sm font-medium"
          >
            + New Filter
          </button>
        )}
      </div>

      <p className="text-xs text-kira-text-dim mb-4">
        {activeCount} of {limit === Infinity ? "unlimited" : limit} active filters used ({tier})
      </p>

      {error && <p className="text-xs text-kira-red mb-4">{error}</p>}

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
        <div className="text-kira-text-muted text-sm">Loading...</div>
      ) : filters.length === 0 ? (
        <div className="bg-kira-surface border border-kira-border rounded-md p-8 text-center text-kira-text-muted text-sm">
          No Signal Filters yet. Create one to get alerted the moment a new token matches your criteria,
          anywhere on Solana, regardless of who's buying.
        </div>
      ) : (
        <div className="space-y-3">
          {filters.map((f) => (
            <div key={f.id} className="bg-kira-surface border border-kira-border rounded-md p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${f.active ? "bg-kira-green" : "bg-kira-text-dim"}`} />
                  <span className="font-display text-sm text-kira-text">{f.name}</span>
                </div>
                <span className="text-xs text-kira-text-dim">{f.matches24h} match{f.matches24h === 1 ? "" : "es"} / 24h</span>
              </div>
              <p className="text-xs text-kira-text-muted mt-2">{criteriaSummary(f)}</p>
              <div className="flex gap-3 mt-3 text-xs">
                <button onClick={() => void handleToggle(f)} className="text-kira-accent hover:underline">
                  {f.active ? "Deactivate" : "Activate"}
                </button>
                <button
                  onClick={() => {
                    setEditing(f);
                    setFormOpen(true);
                  }}
                  className="text-kira-accent hover:underline"
                >
                  Edit
                </button>
                <button onClick={() => void handleDelete(f)} className="text-kira-red hover:underline">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
