import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from "react";
import { useAuth } from "../auth/useAuth.js";
import { useAppData } from "../shell/AppDataContext.js";
import { apiRequest } from "../lib/api.js";
const WINDOW_OPTIONS = [
    { label: "1h", value: 60 },
    { label: "2h", value: 120 },
    { label: "4h", value: 240 },
    { label: "8h", value: 480 },
];
function Section({ title, children }) {
    return (_jsxs("div", { className: "bg-kira-surface border border-kira-border rounded-md p-4", children: [_jsx("h2", { className: "text-xs uppercase tracking-wide text-kira-text-muted mb-3", children: title }), children] }));
}
export default function SettingsPage() {
    const { session } = useAuth();
    const { me, refreshMe } = useAppData();
    const tier = me?.tier ?? "scout";
    const minThreshold = tier === "scout" ? 3 : 2;
    const [threshold, setThreshold] = useState(me?.settings?.cluster_threshold ?? 3);
    const [windowMinutes, setWindowMinutes] = useState(me?.settings?.window_minutes ?? 240);
    const [minUsd, setMinUsd] = useState(me?.settings?.min_usd_per_buy ?? 100);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    async function saveSettings() {
        setSaving(true);
        setSaved(false);
        try {
            await apiRequest("PATCH", "/me/settings", {
                clusterThreshold: threshold,
                windowMinutes,
                minUsdPerBuy: minUsd,
            });
            await refreshMe();
            setSaved(true);
        }
        finally {
            setSaving(false);
        }
    }
    return (_jsxs("div", { className: "space-y-6 max-w-2xl", children: [_jsx("h1", { className: "font-display text-lg text-kira-text", children: "Settings" }), _jsx(Section, { title: "Account", children: _jsxs("dl", { className: "space-y-2 text-sm", children: [_jsxs("div", { className: "flex justify-between", children: [_jsx("dt", { className: "text-kira-text-muted", children: "Email" }), _jsx("dd", { className: "text-kira-text", children: session?.user.email ?? "—" })] }), _jsxs("div", { className: "flex justify-between", children: [_jsx("dt", { className: "text-kira-text-muted", children: "Tier" }), _jsx("dd", { className: "text-kira-text uppercase", children: tier })] }), _jsxs("div", { className: "flex justify-between", children: [_jsx("dt", { className: "text-kira-text-muted", children: "Tier expires" }), _jsx("dd", { className: "text-kira-text", children: me?.tierExpiresAt ? new Date(me.tierExpiresAt).toLocaleDateString() : "Never" })] })] }) }), _jsx(Section, { title: "Telegram", children: me?.profile?.telegram_user_id ? (_jsxs("p", { className: "text-sm text-kira-green", children: ["Connected ", me.profile.telegram_username ? `as @${me.profile.telegram_username}` : ""] })) : (_jsxs(_Fragment, { children: [_jsx("p", { className: "text-sm text-kira-text-muted mb-2", children: "Not connected." }), _jsx("a", { href: "https://t.me/KiraByCeronixBot", target: "_blank", rel: "noreferrer", className: "text-kira-accent text-sm hover:underline", children: "Message @KiraByCeronixBot to connect" })] })) }), _jsx(Section, { title: "Alert Settings", children: _jsxs("div", { className: "space-y-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-xs text-kira-text-muted mb-1", children: "Cluster threshold" }), _jsx("div", { className: "flex gap-2", children: [2, 3].map((t) => (_jsxs("button", { disabled: t < minThreshold, onClick: () => setThreshold(t), className: `text-xs px-3 py-1.5 rounded border ${threshold === t
                                            ? "border-kira-accent text-kira-accent"
                                            : "border-kira-border text-kira-text-muted"} ${t < minThreshold ? "opacity-40 cursor-not-allowed" : ""}`, children: [t, "+ wallets"] }, t))) }), tier === "scout" && _jsx("p", { className: "text-xs text-kira-text-dim mt-1", children: "Scout tier is locked to 3+." })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-xs text-kira-text-muted mb-1", children: "Window" }), _jsx("div", { className: "flex gap-2", children: WINDOW_OPTIONS.map((w) => (_jsx("button", { onClick: () => setWindowMinutes(w.value), className: `text-xs px-3 py-1.5 rounded border ${windowMinutes === w.value
                                            ? "border-kira-accent text-kira-accent"
                                            : "border-kira-border text-kira-text-muted"}`, children: w.label }, w.value))) })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-xs text-kira-text-muted mb-1", children: "Min USD per buy" }), _jsx("input", { type: "number", value: minUsd, onChange: (e) => setMinUsd(Number(e.target.value)), className: "w-32 bg-kira-surface-2 border border-kira-border rounded px-3 py-1.5 text-sm text-kira-text focus:outline-none focus:border-kira-accent" })] }), _jsx("button", { onClick: () => void saveSettings(), disabled: saving, className: "bg-kira-accent text-kira-bg rounded px-4 py-2 text-sm font-medium disabled:opacity-50", children: saving ? "Saving..." : "Save" }), saved && _jsx("span", { className: "text-xs text-kira-green ml-3", children: "Saved." })] }) }), _jsxs(Section, { title: "Billing", children: [_jsxs("p", { className: "text-sm text-kira-text-muted mb-2", children: ["Current tier: ", _jsx("span", { className: "text-kira-text uppercase", children: tier })] }), _jsx("a", { href: "/upgrade", className: "text-kira-accent text-sm hover:underline", children: "Upgrade \u2192" })] })] }));
}
