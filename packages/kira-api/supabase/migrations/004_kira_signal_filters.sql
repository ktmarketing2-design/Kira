-- Signal Filter: custom token discovery alerts.
-- Source of truth: kira-phase1-prd.md Section 14, kira-sprint5-claudecode-prompt.md Part 1.
-- Do not run automatically. Operator runs via the Supabase dashboard or CLI.

create table kira_signal_filters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references kira_profiles(id) on delete cascade,
  name text not null,
  active boolean not null default true,

  -- on-chain criteria (all optional)
  min_liquidity_usd numeric,
  min_fdv_usd numeric,
  max_fdv_usd numeric,
  min_volume_24h numeric,
  min_holders int,
  max_age_hours int,
  launchpads text[],              -- empty array = any launchpad
  min_rug_score int,
  require_lp_locked boolean,
  require_mint_revoked boolean,

  -- volume authenticity (optional)
  min_volume_score int,

  -- social criteria (optional)
  min_social_mindshare numeric,
  min_social_sentiment numeric,
  min_galaxy_score numeric,

  -- roster overlay (optional)
  require_roster_wallet boolean not null default false,
  min_roster_wallets int not null default 1,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on kira_signal_filters (user_id, active);

alter table kira_signal_filters enable row level security;
-- Intended policy (added in a follow-up migration for operator review, per the Sprint 1-2
-- convention of not shipping RLS policy DDL sight-unseen): user can CRUD rows where
-- user_id = auth.uid(). Service role (used by kira-signal-scan) bypasses RLS and reads all
-- active filters for all users.

-- New alert type + linking column for signal filter matches.
alter type kira_alert_type add value 'signal_filter_match';
alter table kira_alerts add column if not exists filter_id uuid references kira_signal_filters(id);
