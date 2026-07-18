import { LogOut } from "lucide-react";
import { useAuth } from "../auth/useAuth.js";
import { useAppData } from "./AppDataContext.js";
import NotificationBell from "./NotificationBell.js";

const tierColors: Record<string, string> = {
  scout: "text-tt-fg-dim border-tt-border",
  pro: "text-tt-brand border-tt-brand",
  elite: "text-tt-amber border-tt-amber",
  studio: "text-tt-amber border-tt-amber",
};

export default function TopBar() {
  const { signOut } = useAuth();
  const { me } = useAppData();
  const tier = me?.tier ?? "scout";

  return (
    <header className="flex items-center justify-end gap-4 px-4 md:px-6 py-3 border-b border-tt-border bg-tt-bg sticky top-0 z-10">
      <span
        className={`font-body text-xs uppercase tracking-wide border rounded-md px-2 py-1 ${tierColors[tier] ?? tierColors.scout}`}
      >
        {tier}
      </span>

      <NotificationBell />

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
