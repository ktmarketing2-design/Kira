import { Bell, LogOut } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/useAuth.js";
import { useAppData } from "./AppDataContext.js";

const tierColors: Record<string, string> = {
  scout: "text-kira-text-muted border-kira-border",
  pro: "text-kira-accent border-kira-accent",
  elite: "text-kira-yellow border-kira-yellow",
  studio: "text-kira-yellow border-kira-yellow",
};

export default function TopBar() {
  const { signOut } = useAuth();
  const { me, unreadCount, markAllRead } = useAppData();
  const tier = me?.tier ?? "scout";

  return (
    <header className="flex items-center justify-end gap-4 px-4 md:px-6 py-3 border-b border-kira-border bg-kira-bg sticky top-0 z-10">
      <span
        className={`font-data text-xs uppercase tracking-wide border rounded px-2 py-1 ${tierColors[tier] ?? tierColors.scout}`}
      >
        {tier}
      </span>

      <Link to="/alerts" onClick={markAllRead} className="relative text-kira-text-muted hover:text-kira-text">
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 bg-kira-red text-white text-[10px] leading-none rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </Link>

      <button
        onClick={() => void signOut()}
        className="text-kira-text-muted hover:text-kira-text"
        title="Sign out"
      >
        <LogOut size={18} />
      </button>
    </header>
  );
}
