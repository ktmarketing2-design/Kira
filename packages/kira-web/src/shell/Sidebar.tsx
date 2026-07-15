import { NavLink } from "react-router-dom";
import { LayoutDashboard, Users, Bell, Target, Megaphone, Search, LineChart, Settings, ArrowUpCircle } from "lucide-react";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/roster", label: "Roster", icon: Users },
  { to: "/alerts", label: "Alerts", icon: Bell },
  { to: "/filters", label: "Signal Filters", icon: Target },
  { to: "/kol", label: "KOL Tracker", icon: Megaphone },
  { to: "/token", label: "Token Search", icon: Search },
  { to: "/pnl", label: "PnL", icon: LineChart },
];

const bottomItems = [
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/upgrade", label: "Upgrade", icon: ArrowUpCircle },
];

function linkClass(active: boolean): string {
  return [
    "flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors",
    active
      ? "bg-kira-surface-2 text-kira-text border-l-2 border-kira-accent"
      : "text-kira-text-muted hover:text-kira-text hover:bg-kira-surface-2/50",
  ].join(" ");
}

export default function Sidebar() {
  return (
    <aside className="hidden md:flex md:flex-col w-56 shrink-0 bg-kira-surface border-r border-kira-border h-screen sticky top-0 px-3 py-4">
      <div className="font-display text-lg tracking-widest text-kira-text px-3 mb-6">KIRA</div>

      <nav className="flex flex-col gap-1">
        {navItems.map((item) => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => linkClass(isActive)}>
            <item.icon size={16} />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-kira-border my-4" />

      <nav className="flex flex-col gap-1">
        {bottomItems.map((item) => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => linkClass(isActive)}>
            <item.icon size={16} />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

export function BottomNav() {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-kira-surface border-t border-kira-border flex justify-around py-2 z-20">
      {navItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `flex flex-col items-center gap-1 px-2 py-1 text-[10px] ${
              isActive ? "text-kira-accent" : "text-kira-text-muted"
            }`
          }
        >
          <item.icon size={18} />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
