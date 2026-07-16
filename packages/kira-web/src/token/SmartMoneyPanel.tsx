import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api.js";

interface SmartMoneyEvent {
  id: number;
  wallet_address: string;
  side: "buy" | "sell";
  usd_value: number | null;
  block_time: string;
  kira_smart_wallets: { label: string; category: string } | { label: string; category: string }[] | null;
}

function walletLabel(event: SmartMoneyEvent): string {
  const rel = event.kira_smart_wallets;
  if (!rel) return `${event.wallet_address.slice(0, 4)}...${event.wallet_address.slice(-4)}`;
  const label = Array.isArray(rel) ? rel[0]?.label : rel.label;
  return label ?? `${event.wallet_address.slice(0, 4)}...${event.wallet_address.slice(-4)}`;
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

/** Timeline of smart-money entries/exits for this specific token, last 24h. */
export default function SmartMoneyPanel({ tokenAddress }: { tokenAddress: string }) {
  const [events, setEvents] = useState<SmartMoneyEvent[] | null>(null);

  useEffect(() => {
    apiRequest<{ events: SmartMoneyEvent[] }>("GET", `/smart-money/events/${tokenAddress}`)
      .then((res) => setEvents(res.events))
      .catch(() => setEvents([]));
  }, [tokenAddress]);

  if (events === null) {
    return <div className="text-kira-text-muted text-sm py-8 text-center">Loading...</div>;
  }

  if (events.length === 0) {
    return (
      <div className="bg-kira-surface border border-kira-border rounded-md p-8 text-center text-kira-text-muted text-sm">
        No smart money activity for this token in the last 24h.
      </div>
    );
  }

  return (
    <div className="bg-kira-surface border border-kira-border rounded-md divide-y divide-kira-border">
      {events.map((e) => (
        <div key={e.id} className="flex items-center justify-between px-4 py-2 text-xs font-data">
          <span className={`w-14 font-medium ${e.side === "buy" ? "text-kira-green" : "text-kira-red"}`}>
            {e.side === "buy" ? "ENTERED" : "EXITED"}
          </span>
          <span className="flex-1 text-kira-text">{walletLabel(e)}</span>
          <span className="text-kira-text-muted">
            {e.usd_value != null ? `$${e.usd_value >= 1000 ? `${(e.usd_value / 1000).toFixed(1)}K` : e.usd_value.toFixed(0)}` : "—"}
          </span>
          <span className="text-kira-text-dim w-16 text-right">{timeAgo(e.block_time)}</span>
        </div>
      ))}
    </div>
  );
}
