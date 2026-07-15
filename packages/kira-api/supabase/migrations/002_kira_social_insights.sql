-- Adds LunarCrush social insight columns to kira_token_snapshots.
-- New migration file rather than editing 001_kira_initial.sql, which may already be applied.
-- Do not run automatically. Operator runs via the Supabase dashboard or CLI.

alter table kira_token_snapshots
  add column if not exists social_mindshare numeric,
  add column if not exists social_mindshare_change numeric,
  add column if not exists social_sentiment numeric,
  add column if not exists social_galaxy_score numeric,
  add column if not exists social_top_influencers jsonb;
