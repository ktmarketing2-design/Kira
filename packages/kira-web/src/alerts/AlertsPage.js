import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api.js";
import DdCardView from "../shell/DdCardView.js";
const TYPES = [
    { value: "all", label: "All" },
    { value: "cluster_buy", label: "Cluster Buy" },
    { value: "cluster_sell", label: "Cluster Sell" },
    { value: "signal_filter_match", label: "Signal Filter" },
];
function truncate(address) {
    if (address.length <= 10)
        return address;
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
}
export default function AlertsPage() {
    const [alerts, setAlerts] = useState([]);
    const [nextCursor, setNextCursor] = useState(null);
    const [loading, setLoading] = useState(true);
    const [typeFilter, setTypeFilter] = useState("all");
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");
    const [expanded, setExpanded] = useState(null);
    const [ddCards, setDdCards] = useState({});
    function load(cursor) {
        setLoading(true);
        const params = new URLSearchParams();
        if (cursor)
            params.set("cursor", cursor);
        if (typeFilter !== "all")
            params.set("type", typeFilter);
        apiRequest("GET", `/alerts?${params.toString()}`)
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
        if (dateFrom && created < new Date(dateFrom).getTime())
            return false;
        if (dateTo && created > new Date(dateTo).getTime() + 86_400_000)
            return false;
        return true;
    });
    async function markAllAsRead() {
        const unread = visible.filter((a) => !a.read);
        await Promise.all(unread.map((a) => apiRequest("POST", `/alerts/${a.id}/read`)));
        setAlerts((prev) => prev.map((a) => ({ ...a, read: true })));
    }
    async function toggleExpand(alert) {
        if (expanded === alert.id) {
            setExpanded(null);
            return;
        }
        setExpanded(alert.id);
        if (!ddCards[alert.token_address]) {
            try {
                const card = await apiRequest("GET", `/token/${alert.token_address}/dd`);
                setDdCards((prev) => ({ ...prev, [alert.token_address]: card }));
            }
            catch {
                // leave unset, render falls back to "no data" below
            }
        }
    }
    return (_jsxs("div", { children: [_jsx("h1", { className: "font-display text-lg text-kira-text mb-4", children: "Alerts" }), _jsxs("div", { className: "flex flex-wrap items-center gap-3 mb-4", children: [_jsx("div", { className: "flex gap-1", children: TYPES.map((t) => (_jsx("button", { onClick: () => setTypeFilter(t.value), className: `text-xs px-2 py-1 rounded border ${typeFilter === t.value
                                ? "border-kira-accent text-kira-accent"
                                : "border-kira-border text-kira-text-muted"}`, children: t.label }, t.value))) }), _jsx("input", { type: "date", value: dateFrom, onChange: (e) => setDateFrom(e.target.value), className: "bg-kira-surface-2 border border-kira-border rounded px-2 py-1 text-xs text-kira-text" }), _jsx("span", { className: "text-kira-text-dim text-xs", children: "to" }), _jsx("input", { type: "date", value: dateTo, onChange: (e) => setDateTo(e.target.value), className: "bg-kira-surface-2 border border-kira-border rounded px-2 py-1 text-xs text-kira-text" }), _jsx("button", { onClick: () => void markAllAsRead(), className: "text-xs text-kira-accent hover:underline ml-auto", children: "Mark all as read" })] }), loading && alerts.length === 0 ? (_jsx("div", { className: "text-kira-text-muted text-sm", children: "Loading..." })) : visible.length === 0 ? (_jsx("div", { className: "bg-kira-surface border border-kira-border rounded-md p-8 text-center text-kira-text-muted text-sm", children: "No alerts match these filters." })) : (_jsx("div", { className: "space-y-2", children: visible.map((alert) => (_jsxs("div", { className: "bg-kira-surface border border-kira-border rounded-md", children: [_jsxs("button", { onClick: () => void toggleExpand(alert), className: "w-full flex items-center justify-between px-4 py-3 text-left", children: [_jsxs("div", { className: "flex items-center gap-3", children: [!alert.read && _jsx("span", { className: "w-1.5 h-1.5 rounded-full bg-kira-accent" }), _jsxs("span", { className: "font-display text-sm text-kira-text", children: ["$", alert.token_symbol ?? "?"] }), _jsx("span", { className: "font-data text-xs text-kira-text-muted", children: truncate(alert.token_address) }), _jsx("span", { className: "text-xs text-kira-text-dim", children: alert.type.replace(/_/g, " ") })] }), _jsx("span", { className: "text-xs text-kira-text-dim", children: new Date(alert.created_at).toLocaleString() })] }), expanded === alert.id && (_jsx("div", { className: "border-t border-kira-border p-4", children: ddCards[alert.token_address] ? (_jsx(DdCardView, { card: ddCards[alert.token_address] })) : (_jsx("div", { className: "text-kira-text-muted text-xs", children: "Loading Deep Dive..." })) }))] }, alert.id))) })), nextCursor && !loading && (_jsx("button", { onClick: () => load(nextCursor), className: "mt-4 text-xs text-kira-accent hover:underline", children: "Load more" }))] }));
}
