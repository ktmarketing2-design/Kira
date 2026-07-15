import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { apiRequest, ApiError } from "../lib/api.js";
import { useAppData } from "../shell/AppDataContext.js";
import AlertCard from "./AlertCard.js";
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export default function DashboardPage() {
    const { liveAlerts, me } = useAppData();
    const [recentAlerts, setRecentAlerts] = useState([]);
    const [walletsTracked, setWalletsTracked] = useState(null);
    const [loadingFeed, setLoadingFeed] = useState(true);
    const [query, setQuery] = useState("");
    const [searchError, setSearchError] = useState(null);
    const [searching, setSearching] = useState(false);
    const navigate = useNavigate();
    useEffect(() => {
        apiRequest("GET", "/alerts")
            .then((res) => setRecentAlerts(res.alerts))
            .catch(() => setRecentAlerts([]))
            .finally(() => setLoadingFeed(false));
        apiRequest("GET", "/roster")
            .then((res) => setWalletsTracked(res.wallets.length))
            .catch(() => setWalletsTracked(null));
    }, []);
    const feed = useMemo(() => {
        const byId = new Map();
        for (const a of [...liveAlerts, ...recentAlerts])
            byId.set(a.id, a);
        return Array.from(byId.values()).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }, [liveAlerts, recentAlerts]);
    const todaysAlerts = useMemo(() => {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        return feed.filter((a) => new Date(a.created_at) >= startOfDay).length;
    }, [feed]);
    async function handleSearch(e) {
        e.preventDefault();
        const address = query.trim();
        if (!SOLANA_ADDRESS_RE.test(address)) {
            setSearchError("Enter a valid Solana token address.");
            return;
        }
        setSearchError(null);
        setSearching(true);
        try {
            await apiRequest("GET", `/token/${address}/dd`);
            navigate(`/token/${address}`);
        }
        catch (err) {
            setSearchError(err instanceof ApiError && err.status === 403 ? "Daily Deep Dive limit reached." : "Couldn't generate a Deep Dive for that address.");
        }
        finally {
            setSearching(false);
        }
    }
    return (_jsxs("div", { className: "grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-6", children: [_jsxs("section", { children: [_jsx("h1", { className: "font-display text-lg text-kira-text mb-4", children: "Live Alert Feed" }), loadingFeed ? (_jsx("div", { className: "text-kira-text-muted text-sm", children: "Loading..." })) : feed.length === 0 ? (_jsxs("div", { className: "bg-kira-surface border border-kira-border rounded-md p-8 text-center", children: [_jsx("p", { className: "text-kira-text text-sm", children: "No alerts yet." }), _jsx("p", { className: "text-kira-text-muted text-xs mt-1", children: "Add wallets to your roster to start receiving cluster alerts." }), _jsx("a", { href: "/roster", className: "inline-block mt-3 text-kira-accent text-sm hover:underline", children: "Go to Roster \u2192" })] })) : (_jsx("div", { className: "space-y-3", children: feed.map((alert) => (_jsx(AlertCard, { alert: alert }, alert.id))) }))] }), _jsxs("section", { className: "space-y-4", children: [_jsxs("div", { className: "bg-kira-surface border border-kira-border rounded-md p-4", children: [_jsx("h2", { className: "text-xs uppercase tracking-wide text-kira-text-muted mb-3", children: "Quick Stats" }), _jsxs("dl", { className: "grid grid-cols-2 gap-3 text-sm", children: [_jsxs("div", { children: [_jsx("dt", { className: "text-kira-text-dim text-xs", children: "Today's Alerts" }), _jsx("dd", { className: "text-kira-text font-data", children: todaysAlerts })] }), _jsxs("div", { children: [_jsx("dt", { className: "text-kira-text-dim text-xs", children: "Wallets Tracked" }), _jsx("dd", { className: "text-kira-text font-data", children: walletsTracked ?? "—" })] }), _jsxs("div", { children: [_jsx("dt", { className: "text-kira-text-dim text-xs", children: "Tokens DD'd" }), _jsx("dd", { className: "text-kira-text-dim font-data text-xs", children: "not tracked yet" })] }), _jsxs("div", { children: [_jsx("dt", { className: "text-kira-text-dim text-xs", children: "Vol Authenticity Avg" }), _jsx("dd", { className: "text-kira-text-dim font-data text-xs", children: "not tracked yet" })] })] })] }), _jsxs("div", { className: "bg-kira-surface border border-kira-border rounded-md p-4", children: [_jsx("h2", { className: "text-xs uppercase tracking-wide text-kira-text-muted mb-3", children: "Token Search" }), _jsxs("form", { onSubmit: handleSearch, className: "flex gap-2", children: [_jsx("input", { value: query, onChange: (e) => setQuery(e.target.value), placeholder: "Solana token address", className: "flex-1 bg-kira-surface-2 border border-kira-border rounded px-3 py-2 text-xs font-data text-kira-text placeholder:text-kira-text-dim focus:outline-none focus:border-kira-accent" }), _jsx("button", { type: "submit", disabled: searching, className: "bg-kira-accent text-kira-bg rounded px-3 py-2 disabled:opacity-50", children: _jsx(Search, { size: 16 }) })] }), searchError && _jsx("p", { className: "text-xs text-kira-red mt-2", children: searchError }), me?.tier === "scout" && (_jsx("p", { className: "text-xs text-kira-text-dim mt-2", children: "Scout tier: 10 Deep Dives/day." }))] })] })] }));
}
