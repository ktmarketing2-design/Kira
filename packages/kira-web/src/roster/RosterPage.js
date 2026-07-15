import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { apiRequest, ApiError } from "../lib/api.js";
import { useAppData } from "../shell/AppDataContext.js";
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const TIER_LIMITS = { scout: 5, pro: 50, elite: Infinity, studio: Infinity };
function truncate(address) {
    if (address.length <= 10)
        return address;
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
}
export default function RosterPage() {
    const { me } = useAppData();
    const [wallets, setWallets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [address, setAddress] = useState("");
    const [label, setLabel] = useState("");
    const [formError, setFormError] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    function load() {
        setLoading(true);
        apiRequest("GET", "/roster")
            .then((res) => setWallets(res.wallets))
            .finally(() => setLoading(false));
    }
    useEffect(load, []);
    async function handleAdd(e) {
        e.preventDefault();
        if (!SOLANA_ADDRESS_RE.test(address.trim())) {
            setFormError("Enter a valid Solana wallet address.");
            return;
        }
        setFormError(null);
        setSubmitting(true);
        try {
            await apiRequest("POST", "/roster", { address: address.trim(), label: label.trim() || undefined });
            setAddress("");
            setLabel("");
            load();
        }
        catch (err) {
            if (err instanceof ApiError && err.status === 403) {
                setFormError("Roster limit reached for your tier. Upgrade to track more wallets.");
            }
            else if (err instanceof ApiError && err.status === 409) {
                setFormError("That wallet is already in your roster.");
            }
            else {
                setFormError("Couldn't add that wallet.");
            }
        }
        finally {
            setSubmitting(false);
        }
    }
    async function handleRemove(walletAddress) {
        await apiRequest("DELETE", `/roster/${walletAddress}`);
        setWallets((prev) => prev.filter((w) => w.address !== walletAddress));
    }
    const tier = me?.tier ?? "scout";
    const limit = TIER_LIMITS[tier] ?? 5;
    return (_jsxs("div", { children: [_jsx("h1", { className: "font-display text-lg text-kira-text mb-4", children: "Roster" }), _jsxs("div", { className: "bg-kira-surface border border-kira-border rounded-md p-4 mb-6", children: [_jsxs("form", { onSubmit: handleAdd, className: "flex flex-col sm:flex-row gap-2", children: [_jsx("input", { value: address, onChange: (e) => setAddress(e.target.value), placeholder: "Wallet address", className: "flex-1 bg-kira-surface-2 border border-kira-border rounded px-3 py-2 text-xs font-data text-kira-text placeholder:text-kira-text-dim focus:outline-none focus:border-kira-accent" }), _jsx("input", { value: label, onChange: (e) => setLabel(e.target.value), placeholder: "Label (optional)", className: "sm:w-40 bg-kira-surface-2 border border-kira-border rounded px-3 py-2 text-xs text-kira-text placeholder:text-kira-text-dim focus:outline-none focus:border-kira-accent" }), _jsx("button", { type: "submit", disabled: submitting, className: "bg-kira-accent text-kira-bg rounded px-4 py-2 text-sm font-medium disabled:opacity-50", children: "Add" })] }), formError && _jsx("p", { className: "text-xs text-kira-red mt-2", children: formError }), _jsxs("p", { className: "text-xs text-kira-text-dim mt-2", children: [wallets.length, " of ", limit === Infinity ? "unlimited" : limit, " wallets used (", tier, ")"] })] }), loading ? (_jsx("div", { className: "text-kira-text-muted text-sm", children: "Loading..." })) : wallets.length === 0 ? (_jsxs("div", { className: "bg-kira-surface border border-kira-border rounded-md p-8 text-center", children: [_jsx("p", { className: "text-kira-text text-sm", children: "Your roster is empty." }), _jsx("p", { className: "text-kira-text-muted text-xs mt-1", children: "Add wallet addresses of traders you respect. When 2+ of them buy the same token, you get alerted immediately." })] })) : (_jsx("div", { className: "bg-kira-surface border border-kira-border rounded-md overflow-x-auto", children: _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "text-left text-xs text-kira-text-muted border-b border-kira-border", children: [_jsx("th", { className: "px-4 py-3 font-normal", children: "Address" }), _jsx("th", { className: "px-4 py-3 font-normal", children: "Label" }), _jsx("th", { className: "px-4 py-3 font-normal", children: "7d Win Rate" }), _jsx("th", { className: "px-4 py-3 font-normal", children: "Avg Return" }), _jsx("th", { className: "px-4 py-3 font-normal", children: "Added" }), _jsx("th", { className: "px-4 py-3 font-normal" })] }) }), _jsx("tbody", { children: wallets.map((w) => (_jsxs("tr", { className: "border-b border-kira-border last:border-0", children: [_jsx("td", { className: "px-4 py-3 font-data text-xs text-kira-text", children: truncate(w.address) }), _jsx("td", { className: "px-4 py-3 text-kira-text-muted", children: w.label ?? "—" }), _jsx("td", { className: "px-4 py-3 text-kira-text-muted font-data text-xs", children: w.performance7d?.win_rate != null ? `${Math.round(w.performance7d.win_rate * 100)}%` : "—" }), _jsx("td", { className: "px-4 py-3 text-kira-text-muted font-data text-xs", children: w.performance7d?.avg_return_pct != null ? `${w.performance7d.avg_return_pct.toFixed(1)}%` : "—" }), _jsx("td", { className: "px-4 py-3 text-kira-text-dim text-xs", children: new Date(w.created_at).toLocaleDateString() }), _jsx("td", { className: "px-4 py-3", children: _jsx("button", { onClick: () => void handleRemove(w.address), className: "text-kira-red text-xs hover:underline", children: "Remove" }) })] }, w.id))) })] }) }))] }));
}
