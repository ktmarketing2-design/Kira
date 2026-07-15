import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiRequest, ApiError } from "../lib/api.js";
import DdCardView from "../shell/DdCardView.js";
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export default function TokenPage() {
    const { address } = useParams();
    const navigate = useNavigate();
    const [card, setCard] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [query, setQuery] = useState("");
    function load(addr) {
        setLoading(true);
        setError(null);
        apiRequest("GET", `/token/${addr}/dd`)
            .then(setCard)
            .catch((err) => {
            setCard(null);
            setError(err instanceof ApiError && err.status === 403
                ? "Daily Deep Dive limit reached for your tier."
                : "Couldn't generate a Deep Dive for that token.");
        })
            .finally(() => setLoading(false));
    }
    useEffect(() => {
        if (address)
            load(address);
    }, [address]);
    function handleSearch(e) {
        e.preventDefault();
        const addr = query.trim();
        if (!SOLANA_ADDRESS_RE.test(addr)) {
            setError("Enter a valid Solana token address.");
            return;
        }
        navigate(`/token/${addr}`);
    }
    if (!address) {
        return (_jsxs("div", { children: [_jsx("h1", { className: "font-display text-lg text-kira-text mb-4", children: "Token Search" }), _jsxs("form", { onSubmit: handleSearch, className: "flex gap-2 max-w-lg", children: [_jsx("input", { value: query, onChange: (e) => setQuery(e.target.value), placeholder: "Solana token address", className: "flex-1 bg-kira-surface-2 border border-kira-border rounded px-3 py-2 text-xs font-data text-kira-text placeholder:text-kira-text-dim focus:outline-none focus:border-kira-accent" }), _jsx("button", { type: "submit", className: "bg-kira-accent text-kira-bg rounded px-4 py-2 text-sm font-medium", children: "Search" })] }), error && _jsx("p", { className: "text-xs text-kira-red mt-2", children: error })] }));
    }
    return (_jsxs("div", { children: [loading && _jsx("div", { className: "text-kira-text-muted text-sm mb-4", children: "Generating Deep Dive..." }), error && _jsx("div", { className: "text-kira-red text-sm mb-4", children: error }), card && (_jsxs(_Fragment, { children: [_jsx(DdCardView, { card: card }), _jsxs("div", { className: "flex gap-3 mt-4", children: [_jsx("button", { onClick: () => load(address), className: "text-sm bg-kira-surface-2 border border-kira-border text-kira-text rounded px-3 py-2 hover:border-kira-accent", children: "Refresh DD" }), _jsx("button", { disabled: true, title: "Coming soon", className: "text-sm bg-kira-surface-2 border border-kira-border text-kira-text-dim rounded px-3 py-2 cursor-not-allowed", children: "Add to Watchlist" })] }), _jsxs("div", { className: "mt-6 border border-dashed border-kira-border rounded-md p-8 text-center", children: [_jsx("p", { className: "text-kira-text-muted text-sm", children: "Chart Studio \u2014 Coming Soon" }), _jsx("p", { className: "text-kira-text-dim text-xs mt-1", children: "Draw trendlines, see on-chain events overlaid on price action." })] })] }))] }));
}
