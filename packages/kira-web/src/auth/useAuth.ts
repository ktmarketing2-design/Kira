import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, configError } from "../lib/supabase.js";
import { apiRequest } from "../lib/api.js";

export interface AuthState {
  session: Session | null;
  userId: string | null;
  loading: boolean;
  configError: string | null;
  sendMagicLink: (email: string) => Promise<string | null>;
  signInWithTelegram: (widgetData: Record<string, unknown>) => Promise<string | null>;
  signOut: () => Promise<void>;
}

export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  async function sendMagicLink(email: string): Promise<string | null> {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/dashboard` },
    });
    return error?.message ?? null;
  }

  /**
   * "Login with Telegram" widget flow: kira-api verifies the widget's own signature and hands
   * back an email + one-time OTP token (see POST /auth/telegram-login), which this completes
   * client-side via verifyOtp -- the same call the email magic-link flow's callback ultimately
   * relies on, just skipping the "click a link in your inbox" step since Telegram already proved
   * identity via its own signed payload.
   */
  async function signInWithTelegram(widgetData: Record<string, unknown>): Promise<string | null> {
    try {
      const res = await apiRequest<{ email: string; token: string }>("POST", "/auth/telegram-login", widgetData);
      const { error } = await supabase.auth.verifyOtp({ email: res.email, token: res.token, type: "email" });
      return error?.message ?? null;
    } catch (err) {
      return err instanceof Error ? err.message : "Telegram sign-in failed";
    }
  }

  async function signOut(): Promise<void> {
    await supabase.auth.signOut();
  }

  return {
    session,
    userId: session?.user.id ?? null,
    loading,
    configError,
    sendMagicLink,
    signInWithTelegram,
    signOut,
  };
}
