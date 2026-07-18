import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { useAppData } from "./AppDataContext.js";

const TITLE_BY_TYPE: Record<string, string> = {
  cluster_buy: "🚨 Cluster buy",
  cluster_sell: "📉 Distribution warning",
  new_token_cluster: "🆕 New token cluster",
  signal_filter_match: "🎯 Signal filter match",
};

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diffMs / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function NotificationBell() {
  const { liveAlerts, unreadCount, markAllRead } = useAppData();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) markAllRead();
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={toggle} className="relative text-tt-fg-dim hover:text-tt-fg">
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 bg-tt-red text-tt-bg text-[10px] leading-none rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-tt-bg-raised border border-tt-border rounded-md z-30 max-h-96 overflow-y-auto">
          <div className="px-4 py-2.5 border-b border-tt-border text-[10px] uppercase tracking-wide text-tt-fg-faint">
            Recent Alerts
          </div>
          {liveAlerts.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-tt-fg-faint">No alerts yet.</div>
          ) : (
            liveAlerts.slice(0, 10).map((a) => (
              <div
                key={a.id}
                onClick={() => {
                  setOpen(false);
                  navigate(`/token/${a.token_address}`);
                }}
                className="px-4 py-2.5 border-b border-tt-border last:border-0 cursor-pointer hover:bg-tt-bg-panel"
              >
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-tt-fg-dim">{TITLE_BY_TYPE[a.type] ?? a.type}</span>
                  <span className="text-tt-fg-faint text-[10px]">{timeAgo(a.created_at)}</span>
                </div>
                <div className="text-tt-fg text-xs">${a.token_symbol ?? "?"}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
