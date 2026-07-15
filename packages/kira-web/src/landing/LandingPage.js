import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const PROBLEMS = [
    {
        quote: "Five tabs open.\nStill late to the move.",
        body: "Tracking wallets across Birdeye, DexScreener, Telegram, and Twitter simultaneously is how you miss the entry. Kira watches everything so you don't have to.",
    },
    {
        quote: "Volume looks real.\nIt isn't.",
        body: "Paid volume leaves fingerprints. FDV vs liquidity ratios, timing entropy, wallet cycling patterns. Kira's Volume Authenticity Engine scores every token before you ape.",
    },
    {
        quote: "KOL called it.\nBut did they own it first?",
        body: "Track which callers are actually right, not just loud. Kira scores every call against real on-chain price data and builds a credibility record over time.",
    },
];
const STEPS = [
    { n: 1, title: "CLUSTER ALERT", body: "2+ of your tracked wallets\nbuy the same token" },
    { n: 2, title: "TOKEN DEEP DIVE", body: "Auto-generated in seconds.\nRug score, volume score,\nsocial signals, market data." },
    { n: 3, title: "VOLUME CHECK", body: "Is the volume real?\nAuthenticity score with\nfull signal breakdown." },
    { n: 4, title: "SMART MONEY", body: "Are labeled wallets\nalso entering?\nCross-confirmed signal." },
    { n: 5, title: "DECIDE", body: "All signals in one place.\nYour call. Your edge." },
];
const FEATURES = [
    {
        icon: "🔍",
        title: "Wallet Cluster Alerts",
        body: "Track wallets you respect. When 2 or more buy the same token within your time window, you get alerted immediately on Telegram and web. First-mover detection included.",
    },
    {
        icon: "🛡",
        title: "Token Deep Dive",
        body: "One-click due diligence. Rug score, honeypot check, LP lock status, deployer history, top holder concentration. Under 10 seconds, every time.",
    },
    {
        icon: "📊",
        title: "Volume Authenticity Engine",
        body: "Six-signal scoring system detects wash trading, bot volume, and manufactured hype before you read the chart wrong.",
    },
    {
        icon: "📡",
        title: "Social Signals",
        body: "Know when your tracked KOL channels have called a token. See DexScreener trending status. Built from real ingestion data, not guesswork.",
    },
];
const PRICING_ROWS = [
    ["Wallet Roster", "5 wallets", "50 wallets", "Unlimited"],
    ["Cluster threshold", "3+ wallets", "2+ wallets", "2+ wallets"],
    ["Token Deep Dives", "10/day", "Unlimited", "Unlimited"],
    ["Alerts", "Web only", "Telegram + Web", "Telegram + Web"],
    ["Signal Filters", "—", "5 filters", "Unlimited"],
    ["KOL Tracker", "View only", "20 accounts", "Unlimited"],
];
function SectionHeading({ children }) {
    return _jsx("h2", { className: "font-display text-2xl sm:text-3xl text-kira-text text-center mb-10", children: children });
}
export default function LandingPage() {
    return (_jsxs("div", { className: "bg-kira-bg text-kira-text", children: [_jsxs("section", { className: "min-h-screen flex flex-col items-center justify-center relative overflow-hidden kira-grid-bg px-4", children: [_jsx("div", { className: "kira-scanlines absolute inset-0 pointer-events-none" }), _jsxs("div", { className: "relative text-center max-w-2xl", children: [_jsx("div", { className: "font-display text-4xl sm:text-6xl tracking-widest mb-1", children: "KIRA" }), _jsx("div", { className: "text-kira-text-muted text-sm mb-8", children: "by Ceronix Labs" }), _jsx("p", { className: "text-xl sm:text-2xl text-kira-text mb-2", children: "See what others miss." }), _jsx("p", { className: "text-xl sm:text-2xl text-kira-accent mb-6", children: "Before they miss it." }), _jsx("p", { className: "text-kira-text-muted text-sm sm:text-base leading-relaxed mb-8 max-w-xl mx-auto", children: "Wallet cluster alerts, volume authenticity, on-chain DD, smart money tracking, and social signals. Unified." }), _jsxs("div", { className: "flex items-center justify-center gap-4 mb-10", children: [_jsx("a", { href: "/login", className: "bg-kira-accent text-kira-bg font-medium text-sm px-5 py-2.5 rounded hover:opacity-90 transition-opacity", children: "Start Free" }), _jsx("a", { href: "#demo", className: "text-kira-text text-sm px-5 py-2.5 rounded border border-kira-border hover:border-kira-accent transition-colors", children: "View Demo \u2192" })] }), _jsx("div", { className: "font-data text-xs text-kira-text-dim", children: "12,847 tokens analyzed \u00A0\u2022\u00A0 3,291 cluster alerts fired \u00A0\u2022\u00A0 847 rug risks flagged" })] })] }), _jsx("section", { className: "py-24 px-4 border-t border-kira-border", children: _jsx("div", { className: "max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6", children: PROBLEMS.map((p) => (_jsxs("div", { className: "bg-kira-surface border border-kira-border rounded-md p-6 hover:bg-kira-surface-2 transition-colors", children: [_jsx("p", { className: "font-display text-lg text-kira-text whitespace-pre-line mb-3", children: p.quote }), _jsx("div", { className: "text-kira-border mb-3", children: "\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014" }), _jsx("p", { className: "text-kira-text-muted text-sm leading-relaxed", children: p.body })] }, p.quote))) }) }), _jsxs("section", { id: "demo", className: "py-24 px-4 border-t border-kira-border", children: [_jsx(SectionHeading, { children: "How It Works" }), _jsx("div", { className: "max-w-5xl mx-auto flex flex-col md:flex-row items-stretch justify-between gap-6", children: STEPS.map((s, i) => (_jsxs("div", { className: "flex md:flex-col items-center gap-4 md:gap-3 flex-1", children: [_jsxs("div", { className: "text-center flex-1", children: [_jsxs("div", { className: "font-data text-kira-accent text-xs mb-1", children: [s.n, "."] }), _jsx("div", { className: "font-display text-sm text-kira-text mb-2", children: s.title }), _jsx("p", { className: "text-kira-text-muted text-xs whitespace-pre-line leading-relaxed", children: s.body })] }), i < STEPS.length - 1 && (_jsx("div", { className: "text-kira-border text-xl md:rotate-90 shrink-0", children: "\u2193" }))] }, s.n))) })] }), _jsxs("section", { className: "py-24 px-4 border-t border-kira-border", children: [_jsx(SectionHeading, { children: "Built for the way you actually trade" }), _jsx("div", { className: "max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-2 gap-4", children: FEATURES.map((f) => (_jsxs("div", { className: "bg-kira-surface border border-kira-border rounded-md p-6", children: [_jsx("div", { className: "text-2xl mb-2", children: f.icon }), _jsx("div", { className: "font-display text-sm text-kira-text mb-2", children: f.title }), _jsx("p", { className: "text-kira-text-muted text-sm leading-relaxed", children: f.body })] }, f.title))) })] }), _jsxs("section", { className: "py-24 px-4 border-t border-kira-border", children: [_jsx(SectionHeading, { children: "Pricing" }), _jsx("div", { className: "max-w-4xl mx-auto overflow-x-auto", children: _jsxs("table", { className: "w-full text-sm border-collapse", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { className: "text-left p-3 text-kira-text-muted font-normal" }), _jsx("th", { className: "p-3 text-kira-text font-display border-b border-kira-border", children: "Scout" }), _jsx("th", { className: "p-3 text-kira-accent font-display border-b border-kira-border", children: "Pro" }), _jsx("th", { className: "p-3 text-kira-yellow font-display border-b border-kira-border", children: "Elite" })] }) }), _jsxs("tbody", { children: [PRICING_ROWS.map((row) => (_jsxs("tr", { className: "border-b border-kira-border", children: [_jsx("td", { className: "p-3 text-kira-text-muted", children: row[0] }), _jsx("td", { className: "p-3 text-center text-kira-text font-data text-xs", children: row[1] }), _jsx("td", { className: "p-3 text-center text-kira-text font-data text-xs", children: row[2] }), _jsx("td", { className: "p-3 text-center text-kira-text font-data text-xs", children: row[3] })] }, row[0]))), _jsxs("tr", { children: [_jsx("td", { className: "p-3" }), _jsx("td", { className: "p-4 text-center", children: _jsx("a", { href: "/login", className: "text-xs border border-kira-border rounded px-3 py-2 inline-block hover:border-kira-accent", children: "Get Started Free" }) }), _jsx("td", { className: "p-4 text-center", children: _jsx("a", { href: "/login", className: "text-xs bg-kira-accent text-kira-bg rounded px-3 py-2 inline-block hover:opacity-90", children: "Start Pro Trial" }) }), _jsx("td", { className: "p-4 text-center", children: _jsx("a", { href: "/login", className: "text-xs border border-kira-yellow text-kira-yellow rounded px-3 py-2 inline-block hover:bg-kira-yellow/10", children: "Go Elite" }) })] })] })] }) })] }), _jsxs("section", { className: "py-24 px-4 border-t border-kira-border text-center", children: [_jsx("p", { className: "text-kira-text-muted text-sm max-w-lg mx-auto leading-relaxed", children: "Kira is built and operated by Ceronix Labs, a product studio building intelligence tools for the next generation of traders." }), _jsx("a", { href: "https://ceronix.ai", target: "_blank", rel: "noreferrer", className: "text-kira-accent text-sm hover:underline mt-2 inline-block", children: "ceronix.ai" })] }), _jsxs("footer", { className: "py-10 px-4 border-t border-kira-border text-center", children: [_jsx("div", { className: "font-display text-sm text-kira-text mb-1", children: "Kira by Ceronix Labs" }), _jsx("a", { href: "https://t.me/KiraByCeronixBot", target: "_blank", rel: "noreferrer", className: "text-kira-accent text-xs hover:underline", children: "@KiraByCeronixBot on Telegram" }), _jsxs("div", { className: "flex items-center justify-center gap-4 mt-4 text-xs text-kira-text-muted", children: [_jsx("span", { className: "opacity-60", children: "Docs" }), _jsx("span", { className: "opacity-60", children: "Twitter" }), _jsx("a", { href: "https://t.me/KiraByCeronixBot", target: "_blank", rel: "noreferrer", className: "hover:text-kira-text", children: "Telegram" })] }), _jsx("p", { className: "text-kira-text-dim text-[11px] mt-4", children: "Not financial advice. Do your own research." })] })] }));
}
