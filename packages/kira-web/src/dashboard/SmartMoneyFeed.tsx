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
    <div className="bg-tt-bg-raised border border-tt-border rounded-md p-5">
      <div className="flex justify-between text-[10px] uppercase tracking-wide text-tt-fg-faint mb-3.5">
        <span>Smart Money Feed</span>
        <span className="text-tt-green">● LIVE</span>
      </div>
      {loading ? (
        <div className="text-tt-fg-dim text-xs">Loading...</div>
      ) : events.length === 0 ? (
        <div className="text-tt-fg-dim text-xs">No smart money activity in the last 24h.</div>
      ) : (
        <div>
          {events.map((e) => (
            <button
              key={e.id}
              onClick={() => navigate(`/token/${e.token_address}`)}
              className="w-full grid grid-cols-[1fr_auto_auto] gap-2.5 items-center text-xs text-left py-2 border-t border-tt-border first:border-t-0"
            >
              <span className="text-tt-fg-dim">{walletLabel(e)}</span>
              <span className={e.side === "buy" ? "text-tt-green" : "text-tt-red"}>
                {e.side === "buy" ? "bought" : "sold"} {truncate(e.token_address)}
              </span>
              <span className="text-tt-fg-faint text-[10px]">{timeAgo(e.block_time)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
