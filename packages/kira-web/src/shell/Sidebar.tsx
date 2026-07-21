import { NavLink } from "react-router-dom";
import { LayoutDashboard, Users, Bell, Target, Megaphone, Search, LineChart, Settings, ArrowUpCircle, Rocket, Star } from "lucide-react";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/discover", label: "Discover", icon: Rocket },
  { to: "/watchlist", label: "Watchlist", icon: Star },
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
    "flex items-center gap-3 px-3 py-2 text-xs transition-colors",
    active ? "text-tt-brand" : "text-tt-fg-dim hover:text-tt-fg",
  ].join(" ");
}

export default function Sidebar() {
  return (
    <aside className="hidden md:flex md:flex-col w-[210px] shrink-0 bg-tt-bg border-r border-tt-border h-screen sticky top-0 px-4 py-5">
      <img src="/kira-logo.jpeg" alt="Kira by Ceronix Labs" className="w-[150px] h-[44px] object-cover object-center rounded-[3px] mb-7" />

      <nav className="flex flex-col">
        {navItems.map((item) => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => linkClass(isActive)}>
            <item.icon size={15} />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-tt-border my-4" />

      <nav className="flex flex-col">
        {bottomItems.map((item) => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => linkClass(isActive)}>
            <item.icon size={15} />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

export function BottomNav() {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-tt-bg border-t border-tt-border flex justify-around py-2 z-20">
      {navItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `flex flex-col items-center gap-1 px-2 py-1 text-[10px] ${
              isActive ? "text-tt-brand" : "text-tt-fg-dim"
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
