import { Bell, LogOut } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/useAuth.js";
import { useAppData } from "./AppDataContext.js";

const tierColors: Record<string, string> = {
  scout: "text-tt-fg-dim border-tt-border",
  pro: "text-tt-brand border-tt-brand",
  elite: "text-tt-amber border-tt-amber",
  studio: "text-tt-amber border-tt-amber",
};

export default function TopBar() {
  const { signOut } = useAuth();
  const { me, unreadCount, markAllRead } = useAppData();
  const tier = me?.tier ?? "scout";

  return (
    <header className="flex items-center justify-end gap-4 px-4 md:px-6 py-3 border-b border-tt-border bg-tt-bg sticky top-0 z-10">
      <span
        className={`font-body text-xs uppercase tracking-wide border rounded-md px-2 py-1 ${tierColors[tier] ?? tierColors.scout}`}
      >
        {tier}
      </span>

      <Link to="/alerts" onClick={markAllRead} className="relative text-tt-fg-dim hover:text-tt-fg">
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 bg-tt-red text-tt-bg text-[10px] leading-none rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </Link>

      <button
        onClick={() => void signOut()}
        className="text-tt-fg-dim hover:text-tt-fg"
        title="Sign out"
      >
        <LogOut size={18} />
      </button>
    </header>
  );
}
