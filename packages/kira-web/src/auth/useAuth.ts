import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, configError } from "../lib/supabase.js";

export interface AuthState {
  session: Session | null;
  userId: string | null;
  loading: boolean;
  configError: string | null;
  sendMagicLink: (email: string) => Promise<string | null>;
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

  async function signOut(): Promise<void> {
    await supabase.auth.signOut();
  }

  return {
    session,
    userId: session?.user.id ?? null,
    loading,
    configError,
    sendMagicLink,
    signOut,
  };
}
