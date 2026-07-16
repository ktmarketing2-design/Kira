import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../lib/api.js";

interface SmartMoneyEvent {
  id: number;
  wallet_address: string;
  token_address: string;
  side: "buy" | "sell";
  usd_value: number | null;
  block_time: string;
  kira_smart_wallets: { label: string; category: string } | { label: string; category: string }[] | null;
}

function walletLabel(event: SmartMoneyEvent): string {
  const rel = event.kira_smart_wallets;
  if (!rel) return `${event.wallet_address.slice(0, 4)}...`;
  const label = Array.isArray(rel) ? rel[0]?.label : rel.label;
  return label ?? `${event.wallet_address.slice(0, 4)}...`;
}

function truncate(address: string): string {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function SmartMoneyFeed() {
  const [events, setEvents] = useState<SmartMoneyEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    apiRequest<{ events: SmartMoneyEvent[] }>("GET", "/smart-money/events")
      .then((res) => setEvents(res.events.slice(0, 5)))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="bg-kira-surface border border-kira-border rounded-md p-4">
      <h2 className="text-xs uppercase tracking-wide text-kira-text-muted mb-3">Smart Money Feed</h2>
      {loading ? (
        <div className="text-kira-text-dim text-xs">Loading...</div>
      ) : events.length === 0 ? (
        <div className="text-kira-text-dim text-xs">No smart money activity in the last 24h.</div>
      ) : (
        <div className="space-y-2">
          {events.map((e) => (
            <button
              key={e.id}
              onClick={() => navigate(`/token/${e.token_address}`)}
              className="w-full flex items-center justify-between text-xs text-left hover:bg-kira-surface-2 rounded px-1 py-1"
            >
              <span className="text-kira-text-muted">{walletLabel(e)}</span>
              <span className={e.side === "buy" ? "text-kira-green" : "text-kira-red"}>
                {e.side === "buy" ? "bought" : "sold"} {truncate(e.token_address)}
              </span>
              <span className="text-kira-text-dim">{timeAgo(e.block_time)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
