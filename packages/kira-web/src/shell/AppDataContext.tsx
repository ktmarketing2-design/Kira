import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "../lib/supabase.js";
import { apiRequest } from "../lib/api.js";
import { useAuth } from "../auth/useAuth.js";
import type { Alert, MeResponse } from "../lib/types.js";
import { playAlertSound } from "../lib/alertSound.js";

interface AppDataState {
  me: MeResponse | null;
  meLoading: boolean;
  refreshMe: () => Promise<void>;
  liveAlerts: Alert[];
  unreadCount: number;
  markAllRead: () => void;
}

const AppDataContext = createContext<AppDataState | null>(null);

const MAX_LIVE_ALERTS = 20;

export function AppDataProvider({ children }: { children: ReactNode }) {
  const { userId } = useAuth();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [meLoading, setMeLoading] = useState(true);
  const [liveAlerts, setLiveAlerts] = useState<Alert[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  async function refreshMe() {
    setMeLoading(true);
    try {
      const result = await apiRequest<MeResponse>("GET", "/me");
      setMe(result);
    } catch {
      setMe(null);
    } finally {
      setMeLoading(false);
    }
  }

  useEffect(() => {
    if (userId) void refreshMe();
  }, [userId]);

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`alerts:${userId}`)
      .on("broadcast", { event: "new_alert" }, (payload) => {
        const alert = payload.payload as Alert;
        setLiveAlerts((prev) => [alert, ...prev].slice(0, MAX_LIVE_ALERTS));
        setUnreadCount((prev) => prev + 1);
        playAlertSound();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  function markAllRead() {
    setUnreadCount(0);
  }

  return (
    <AppDataContext.Provider value={{ me, meLoading, refreshMe, liveAlerts, unreadCount, markAllRead }}>
      {children}
    </AppDataContext.Provider>
  );
}

export function useAppData(): AppDataState {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error("useAppData must be used within AppDataProvider");
  return ctx;
}
