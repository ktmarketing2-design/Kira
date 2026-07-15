import { Link } from "react-router-dom";
import type { Alert } from "../lib/types.js";

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function truncate(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

const borderByType: Record<string, string> = {
  cluster_buy: "border-l-kira-green",
  cluster_sell: "border-l-kira-red",
  new_token_cluster: "border-l-kira-green",
  signal_filter_match: "border-l-kira-accent",
};

const titleByType: Record<string, string> = {
  cluster_buy: "🚨 CLUSTER ALERT",
  cluster_sell: "📉 DISTRIBUTION WARNING",
  new_token_cluster: "🆕 NEW TOKEN CLUSTER",
  signal_filter_match: "🎯 SIGNAL FILTER MATCH",
};

export default function AlertCard({ alert }: { alert: Alert }) {
  return (
    <div
      className={`bg-kira-surface border border-kira-border border-l-4 ${borderByType[alert.type] ?? "border-l-kira-border"} rounded-md p-4`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-kira-text-muted">{titleByType[alert.type] ?? alert.type}</span>
        <span className="text-xs text-kira-text-dim">{timeAgo(alert.created_at)}</span>
      </div>

      <div className="flex items-baseline gap-2 mb-2">
        <span className="font-display text-sm text-kira-text">${alert.token_symbol ?? "?"}</span>
        <Link to={`/token/${alert.token_address}`} className="font-data text-xs text-kira-accent hover:underline">
          {truncate(alert.token_address)}
        </Link>
      </div>

      <div className="text-xs text-kira-text-muted mb-2">
        {alert.wallet_count} wallets • ${(alert.total_usd ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 })} total
        {alert.first_buyer_address && <> • First: {truncate(alert.first_buyer_address)}</>}
      </div>

      <div className="text-xs text-kira-text-muted mb-3">
        {alert.dd_score != null && <>🛡 Rug: {alert.dd_score}/100 </>}
        {alert.volume_score != null && <> 📊 Vol: {alert.volume_score}/100</>}
      </div>

      <div className="flex gap-3 text-xs">
        <Link to={`/token/${alert.token_address}`} className="text-kira-accent hover:underline">
          Full DD
        </Link>
        <span className="text-kira-text-dim">Add to Watchlist</span>
        <span className="text-kira-text-dim">Mute</span>
      </div>
    </div>
  );
}
