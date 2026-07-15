import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api.js";
import DdCardView from "../shell/DdCardView.js";
import type { Alert, DdCard } from "../lib/types.js";

const TYPES: Array<{ value: Alert["type"] | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "cluster_buy", label: "Cluster Buy" },
  { value: "cluster_sell", label: "Cluster Sell" },
  { value: "signal_filter_match", label: "Signal Filter" },
];

function truncate(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<Alert["type"] | "all">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [ddCards, setDdCards] = useState<Record<string, DdCard>>({});

  function load(cursor?: string) {
    setLoading(true);
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    if (typeFilter !== "all") params.set("type", typeFilter);
    apiRequest<{ alerts: Alert[]; nextCursor: string | null }>("GET", `/alerts?${params.toString()}`)
      .then((res) => {
        setAlerts((prev) => (cursor ? [...prev, ...res.alerts] : res.alerts));
        setNextCursor(res.nextCursor);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter]);

  const visible = alerts.filter((a) => {
    const created = new Date(a.created_at).getTime();
    if (dateFrom && created < new Date(dateFrom).getTime()) return false;
    if (dateTo && created > new Date(dateTo).getTime() + 86_400_000) return false;
    return true;
  });

  async function markAllAsRead() {
    const unread = visible.filter((a) => !a.read);
    await Promise.all(unread.map((a) => apiRequest("POST", `/alerts/${a.id}/read`)));
    setAlerts((prev) => prev.map((a) => ({ ...a, read: true })));
  }

  async function toggleExpand(alert: Alert) {
    if (expanded === alert.id) {
      setExpanded(null);
      return;
    }
    setExpanded(alert.id);
    if (!ddCards[alert.token_address]) {
      try {
        const card = await apiRequest<DdCard>("GET", `/token/${alert.token_address}/dd`);
        setDdCards((prev) => ({ ...prev, [alert.token_address]: card }));
      } catch {
        // leave unset, render falls back to "no data" below
      }
    }
  }

  return (
    <div>
      <h1 className="font-display text-lg text-kira-text mb-4">Alerts</h1>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex gap-1">
          {TYPES.map((t) => (
            <button
              key={t.value}
              onClick={() => setTypeFilter(t.value)}
              className={`text-xs px-2 py-1 rounded border ${
                typeFilter === t.value
                  ? "border-kira-accent text-kira-accent"
                  : "border-kira-border text-kira-text-muted"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="bg-kira-surface-2 border border-kira-border rounded px-2 py-1 text-xs text-kira-text"
        />
        <span className="text-kira-text-dim text-xs">to</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="bg-kira-surface-2 border border-kira-border rounded px-2 py-1 text-xs text-kira-text"
        />
        <button onClick={() => void markAllAsRead()} className="text-xs text-kira-accent hover:underline ml-auto">
          Mark all as read
        </button>
      </div>

      {loading && alerts.length === 0 ? (
        <div className="text-kira-text-muted text-sm">Loading...</div>
      ) : visible.length === 0 ? (
        <div className="bg-kira-surface border border-kira-border rounded-md p-8 text-center text-kira-text-muted text-sm">
          No alerts match these filters.
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((alert) => (
            <div key={alert.id} className="bg-kira-surface border border-kira-border rounded-md">
              <button
                onClick={() => void toggleExpand(alert)}
                className="w-full flex items-center justify-between px-4 py-3 text-left"
              >
                <div className="flex items-center gap-3">
                  {!alert.read && <span className="w-1.5 h-1.5 rounded-full bg-kira-accent" />}
                  <span className="font-display text-sm text-kira-text">${alert.token_symbol ?? "?"}</span>
                  <span className="font-data text-xs text-kira-text-muted">{truncate(alert.token_address)}</span>
                  <span className="text-xs text-kira-text-dim">{alert.type.replace(/_/g, " ")}</span>
                </div>
                <span className="text-xs text-kira-text-dim">
                  {new Date(alert.created_at).toLocaleString()}
                </span>
              </button>
              {expanded === alert.id && (
                <div className="border-t border-kira-border p-4">
                  {ddCards[alert.token_address] ? (
                    <DdCardView card={ddCards[alert.token_address]} />
                  ) : (
                    <div className="text-kira-text-muted text-xs">Loading Deep Dive...</div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {nextCursor && !loading && (
        <button
          onClick={() => load(nextCursor)}
          className="mt-4 text-xs text-kira-accent hover:underline"
        >
          Load more
        </button>
      )}
    </div>
  );
}
