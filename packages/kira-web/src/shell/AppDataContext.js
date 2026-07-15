import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../lib/supabase.js";
import { apiRequest } from "../lib/api.js";
import { useAuth } from "../auth/useAuth.js";
const AppDataContext = createContext(null);
const MAX_LIVE_ALERTS = 20;
export function AppDataProvider({ children }) {
    const { userId } = useAuth();
    const [me, setMe] = useState(null);
    const [meLoading, setMeLoading] = useState(true);
    const [liveAlerts, setLiveAlerts] = useState([]);
    const [unreadCount, setUnreadCount] = useState(0);
    async function refreshMe() {
        setMeLoading(true);
        try {
            const result = await apiRequest("GET", "/me");
            setMe(result);
        }
        catch {
            setMe(null);
        }
        finally {
            setMeLoading(false);
        }
    }
    useEffect(() => {
        if (userId)
            void refreshMe();
    }, [userId]);
    useEffect(() => {
        if (!userId)
            return;
        const channel = supabase
            .channel(`alerts:${userId}`)
            .on("broadcast", { event: "new_alert" }, (payload) => {
            const alert = payload.payload;
            setLiveAlerts((prev) => [alert, ...prev].slice(0, MAX_LIVE_ALERTS));
            setUnreadCount((prev) => prev + 1);
        })
            .subscribe();
        return () => {
            void supabase.removeChannel(channel);
        };
    }, [userId]);
    function markAllRead() {
        setUnreadCount(0);
    }
    return (_jsx(AppDataContext.Provider, { value: { me, meLoading, refreshMe, liveAlerts, unreadCount, markAllRead }, children: children }));
}
export function useAppData() {
    const ctx = useContext(AppDataContext);
    if (!ctx)
        throw new Error("useAppData must be used within AppDataProvider");
    return ctx;
}
