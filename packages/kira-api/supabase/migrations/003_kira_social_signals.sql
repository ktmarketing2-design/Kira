-- Adds zero-cost social signal columns to kira_token_snapshots (KOL mention count from Kira's
-- own kira_kol_calls log, DexScreener trending flag). Additive to 002's LunarCrush columns,
-- which stay in the schema for when that subscription is active.
-- Do not run automatically. Operator runs via the Supabase dashboard or CLI.

alter table kira_token_snapshots
  add column if not exists social_kol_mentions int,
  add column if not exists social_trending boolean;
