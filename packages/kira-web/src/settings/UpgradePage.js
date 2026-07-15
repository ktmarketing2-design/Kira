import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const TIERS = [
    { name: "Scout", price: "Free", features: ["5 wallets", "10 Deep Dives/day", "Threshold 3+", "Web alerts only"] },
    { name: "Pro", price: "$29/mo", features: ["50 wallets", "Unlimited Deep Dives", "Threshold 2+", "Telegram + Web alerts", "5 Signal Filters"] },
    { name: "Elite", price: "$79/mo", features: ["Unlimited wallets", "Threshold 2+", "Telegram + Web alerts", "Unlimited Signal Filters"] },
];
export default function UpgradePage() {
    return (_jsxs("div", { children: [_jsx("h1", { className: "font-display text-lg text-kira-text mb-1", children: "Upgrade" }), _jsx("p", { className: "text-kira-text-muted text-sm mb-6", children: "Payment processing is coming soon." }), _jsx("div", { className: "grid grid-cols-1 sm:grid-cols-3 gap-4", children: TIERS.map((t) => (_jsxs("div", { className: "bg-kira-surface border border-kira-border rounded-md p-4", children: [_jsx("div", { className: "font-display text-kira-text mb-1", children: t.name }), _jsx("div", { className: "text-kira-accent text-lg mb-3", children: t.price }), _jsx("ul", { className: "space-y-1 text-xs text-kira-text-muted mb-4", children: t.features.map((f) => (_jsxs("li", { children: ["\u2022 ", f] }, f))) }), _jsx("button", { disabled: true, title: "Coming soon", className: "w-full text-xs bg-kira-surface-2 border border-kira-border text-kira-text-dim rounded px-3 py-2 cursor-not-allowed", children: "Coming soon" })] }, t.name))) })] }));
}
