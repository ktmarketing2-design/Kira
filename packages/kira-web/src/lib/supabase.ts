import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const configError =
  !url || !anonKey ? "Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY at build time." : null;

// Guard against calling createClient with empty strings, which throws immediately.
export const supabase = createClient(url || "https://placeholder.supabase.co", anonKey || "placeholder");
