import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Link } from "react-router-dom";
function timeAgo(iso) {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diffMs / 60_000);
    if (mins < 1)
        return "just now";
    if (mins < 60)
        return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24)
        return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}
function truncate(address) {
    if (address.length <= 10)
        return address;
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
}
const borderByType = {
    cluster_buy: "border-l-kira-green",
    cluster_sell: "border-l-kira-red",
    new_token_cluster: "border-l-kira-green",
    signal_filter_match: "border-l-kira-accent",
};
const titleByType = {
    cluster_buy: "🚨 CLUSTER ALERT",
    cluster_sell: "📉 DISTRIBUTION WARNING",
    new_token_cluster: "🆕 NEW TOKEN CLUSTER",
    signal_filter_match: "🎯 SIGNAL FILTER MATCH",
};
export default function AlertCard({ alert }) {
    return (_jsxs("div", { className: `bg-kira-surface border border-kira-border border-l-4 ${borderByType[alert.type] ?? "border-l-kira-border"} rounded-md p-4`, children: [_jsxs("div", { className: "flex items-center justify-between mb-2", children: [_jsx("span", { className: "text-xs font-medium text-kira-text-muted", children: titleByType[alert.type] ?? alert.type }), _jsx("span", { className: "text-xs text-kira-text-dim", children: timeAgo(alert.created_at) })] }), _jsxs("div", { className: "flex items-baseline gap-2 mb-2", children: [_jsxs("span", { className: "font-display text-sm text-kira-text", children: ["$", alert.token_symbol ?? "?"] }), _jsx(Link, { to: `/token/${alert.token_address}`, className: "font-data text-xs text-kira-accent hover:underline", children: truncate(alert.token_address) })] }), _jsxs("div", { className: "text-xs text-kira-text-muted mb-2", children: [alert.wallet_count, " wallets \u2022 $", (alert.total_usd ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 }), " total", alert.first_buyer_address && _jsxs(_Fragment, { children: [" \u2022 First: ", truncate(alert.first_buyer_address)] })] }), _jsxs("div", { className: "text-xs text-kira-text-muted mb-3", children: [alert.dd_score != null && _jsxs(_Fragment, { children: ["\uD83D\uDEE1 Rug: ", alert.dd_score, "/100 "] }), alert.volume_score != null && _jsxs(_Fragment, { children: [" \uD83D\uDCCA Vol: ", alert.volume_score, "/100"] })] }), _jsxs("div", { className: "flex gap-3 text-xs", children: [_jsx(Link, { to: `/token/${alert.token_address}`, className: "text-kira-accent hover:underline", children: "Full DD" }), _jsx("span", { className: "text-kira-text-dim", children: "Add to Watchlist" }), _jsx("span", { className: "text-kira-text-dim", children: "Mute" })] })] }));
}
