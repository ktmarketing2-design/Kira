import { Link } from "react-router-dom";
import type { Alert } from "../lib/types.js";
import WatchlistButton from "../shell/WatchlistButton.js";

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

const dotByType: Record<string, string> = {
  cluster_buy: "bg-tt-green",
  cluster_sell: "bg-tt-red",
  new_token_cluster: "bg-tt-green",
  signal_filter_match: "bg-tt-brand",
};

const titleByType: Record<string, string> = {
  cluster_buy: "🚨 CLUSTER ALERT",
  cluster_sell: "📉 DISTRIBUTION WARNING",
  new_token_cluster: "🆕 NEW TOKEN CLUSTER",
  signal_filter_match: "🎯 SIGNAL FILTER MATCH",
};

export default function AlertCard({ alert }: { alert: Alert }) {
  return (
    <div className="bg-tt-bg border border-tt-border rounded-md p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-1.5 h-1.5 rounded-full ${dotByType[alert.type] ?? "bg-tt-fg-faint"}`} />
        <span className="text-xs font-medium text-tt-fg-dim flex-1">{titleByType[alert.type] ?? alert.type}</span>
        <span className="text-[10px] text-tt-fg-faint">{timeAgo(alert.created_at)}</span>
      </div>

      <div className="flex items-baseline gap-2 mb-2">
        <span className="font-display text-sm text-tt-fg">${alert.token_symbol ?? "?"}</span>
        <Link to={`/token/${alert.token_address}`} className="font-body text-xs text-tt-brand hover:underline">
          {truncate(alert.token_address)}
        </Link>
      </div>

      <div className="text-xs text-tt-fg-dim mb-2">
        {alert.wallet_count} wallets • ${(alert.total_usd ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 })} total
        {alert.first_buyer_address && <> • First: {truncate(alert.first_buyer_address)}</>}
      </div>

      <div className="text-xs text-tt-fg-dim mb-3">
        {alert.dd_score != null && <>🛡 Rug: {alert.dd_score}/100 </>}
        {alert.volume_score != null && <> 📊 Vol: {alert.volume_score}/100</>}
      </div>

      <div className="flex gap-3 text-xs">
        <Link to={`/token/${alert.token_address}`} className="text-tt-brand hover:underline">
          Full DD
        </Link>
        <WatchlistButton tokenAddress={alert.token_address} tokenSymbol={alert.token_symbol} />
        <span className="text-tt-fg-faint">Mute</span>
      </div>
    </div>
  );
}
