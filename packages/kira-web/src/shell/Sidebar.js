import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { NavLink } from "react-router-dom";
import { LayoutDashboard, Users, Bell, Search, Settings, ArrowUpCircle } from "lucide-react";
const navItems = [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/roster", label: "Roster", icon: Users },
    { to: "/alerts", label: "Alerts", icon: Bell },
    { to: "/token", label: "Token Search", icon: Search },
];
const bottomItems = [
    { to: "/settings", label: "Settings", icon: Settings },
    { to: "/upgrade", label: "Upgrade", icon: ArrowUpCircle },
];
function linkClass(active) {
    return [
        "flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors",
        active
            ? "bg-kira-surface-2 text-kira-text border-l-2 border-kira-accent"
            : "text-kira-text-muted hover:text-kira-text hover:bg-kira-surface-2/50",
    ].join(" ");
}
export default function Sidebar() {
    return (_jsxs("aside", { className: "hidden md:flex md:flex-col w-56 shrink-0 bg-kira-surface border-r border-kira-border h-screen sticky top-0 px-3 py-4", children: [_jsx("div", { className: "font-display text-lg tracking-widest text-kira-text px-3 mb-6", children: "KIRA" }), _jsx("nav", { className: "flex flex-col gap-1", children: navItems.map((item) => (_jsxs(NavLink, { to: item.to, className: ({ isActive }) => linkClass(isActive), children: [_jsx(item.icon, { size: 16 }), item.label] }, item.to))) }), _jsx("div", { className: "border-t border-kira-border my-4" }), _jsx("nav", { className: "flex flex-col gap-1", children: bottomItems.map((item) => (_jsxs(NavLink, { to: item.to, className: ({ isActive }) => linkClass(isActive), children: [_jsx(item.icon, { size: 16 }), item.label] }, item.to))) })] }));
}
export function BottomNav() {
    return (_jsx("nav", { className: "md:hidden fixed bottom-0 left-0 right-0 bg-kira-surface border-t border-kira-border flex justify-around py-2 z-20", children: navItems.map((item) => (_jsxs(NavLink, { to: item.to, className: ({ isActive }) => `flex flex-col items-center gap-1 px-2 py-1 text-[10px] ${isActive ? "text-kira-accent" : "text-kira-text-muted"}`, children: [_jsx(item.icon, { size: 18 }), item.label] }, item.to))) }));
}
