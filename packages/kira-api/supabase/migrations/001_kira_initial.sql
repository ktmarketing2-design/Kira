-- Kira Phase 1 initial schema.
-- Source of truth: kira-phase1-prd.md, Section 4.
-- Do not run automatically. Operator runs via the Supabase dashboard or CLI.
-- RLS is enabled on every table; the service role (used by kira-api / kira-workers) bypasses RLS.

-- ============================================================
-- USERS & BILLING
-- ============================================================

create type kira_tier as enum ('scout', 'pro', 'elite', 'studio');

create table kira_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  telegram_user_id bigint unique,
  telegram_username text,
  tier kira_tier not null default 'scout',
  tier_expires_at timestamptz,
  lemonsqueezy_customer_id text,
  nowpayments_customer_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One-time codes for linking Telegram to web account
create table kira_link_codes (
  code text primary key,                      -- short random token
  user_id uuid not null references kira_profiles(id) on delete cascade,
  expires_at timestamptz not null,
  used boolean not null default false
);

-- ============================================================
-- WALLET ROSTER
-- ============================================================

create table kira_roster_wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references kira_profiles(id) on delete cascade,
  address text not null,                      -- base58 Solana address
  label text,
  created_at timestamptz not null default now(),
  unique (user_id, address)
);
create index on kira_roster_wallets (address);
create index on kira_roster_wallets (user_id);

-- Global registry of every address we watch (union of all rosters + house list)
create table kira_watched_addresses (
  address text primary key,
  watcher_count int not null default 0,       -- how many rosters include it
  is_house boolean not null default false,    -- true for the global smart-money list
  helius_registered boolean not null default false,
  first_seen timestamptz not null default now()
);

-- ============================================================
-- WALLET EVENTS (from Helius webhooks)
-- ============================================================

create type kira_event_side as enum ('buy', 'sell');

create table kira_wallet_events (
  id bigint generated always as identity primary key,
  signature text not null unique,
  wallet_address text not null,
  token_address text not null,
  side kira_event_side not null,
  token_amount numeric,
  usd_value numeric,
  block_time timestamptz not null,
  raw jsonb,
  created_at timestamptz not null default now()
);
create index on kira_wallet_events (wallet_address, block_time desc);
create index on kira_wallet_events (token_address, block_time desc);

-- ============================================================
-- ALERTS
-- ============================================================

create type kira_alert_type as enum (
  'cluster_buy',        -- 2+/3+ roster wallets bought same token
  'cluster_sell',       -- distribution warning
  'new_token_cluster'   -- cluster on token < 48h old
);

create table kira_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references kira_profiles(id) on delete cascade,
  type kira_alert_type not null,
  token_address text not null,
  token_symbol text,
  wallet_addresses text[] not null,           -- which roster wallets triggered it
  wallet_count int not null,
  total_usd numeric,
  window_minutes int not null,
  first_buyer_address text,                   -- first-mover
  dd_score int,                               -- snapshot of rug check score at alert time
  volume_score int,                           -- snapshot of volume authenticity at alert time
  delivered_telegram boolean not null default false,
  delivered_web boolean not null default false,
  created_at timestamptz not null default now()
);
create index on kira_alerts (user_id, created_at desc);

-- Per-user alert settings
create table kira_alert_settings (
  user_id uuid primary key references kira_profiles(id) on delete cascade,
  cluster_threshold int not null default 3,   -- Scout locked to 3; Pro/Elite may set 2
  window_minutes int not null default 240,    -- default 4h window
  min_usd_per_buy numeric not null default 100,
  quiet_hours_start smallint,                 -- 0-23 local, null = no quiet hours
  quiet_hours_end smallint,
  timezone text not null default 'Africa/Lagos'
);

-- ============================================================
-- TOKEN INTELLIGENCE (DD cards + volume scores, cached snapshots)
-- ============================================================

create table kira_token_snapshots (
  id uuid primary key default gen_random_uuid(),
  token_address text not null,
  symbol text,
  name text,
  chain text not null default 'solana',
  -- market
  fdv_usd numeric,
  liquidity_usd numeric,
  volume_24h_usd numeric,
  holders int,
  launched_at timestamptz,
  -- safety
  mint_authority_revoked boolean,
  freeze_authority_revoked boolean,
  lp_locked boolean,
  lp_lock_expires timestamptz,
  honeypot_clean boolean,
  top10_holder_pct numeric,
  deployer_address text,
  deployer_prior_rugs int,
  rug_score int,                              -- 0-100, higher = safer
  -- volume authenticity
  vol_liq_ratio numeric,
  fdv_liq_ratio numeric,
  unique_buyers int,
  unique_sellers int,
  timing_entropy numeric,
  new_wallet_ratio numeric,
  volume_score int,                           -- 0-100, higher = more organic
  volume_verdict text,                        -- 'organic' | 'mixed' | 'likely_paid' | 'wash'
  -- AI
  verdict_text text,                          -- Gemini one-paragraph summary
  created_at timestamptz not null default now()
);
create index on kira_token_snapshots (token_address, created_at desc);

-- ============================================================
-- WALLET PERFORMANCE (nightly job)
-- ============================================================

create table kira_wallet_performance (
  wallet_address text not null,
  period text not null,                       -- '7d' | '30d' | '90d'
  trades int not null default 0,
  wins int not null default 0,                -- trade exceeded 2x from entry at any point
  win_rate numeric,
  avg_return_pct numeric,
  computed_at timestamptz not null default now(),
  primary key (wallet_address, period)
);

-- ============================================================
-- KOL INGESTION (silent in Phase 1)
-- ============================================================

create table kira_kol_sources (
  id uuid primary key default gen_random_uuid(),
  platform text not null default 'telegram',
  channel_identifier text not null unique,    -- @handle or channel id
  display_name text,
  active boolean not null default true,
  added_at timestamptz not null default now()
);

create table kira_kol_calls (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references kira_kol_sources(id),
  message_id text not null,
  token_address text not null,
  called_at timestamptz not null,
  price_at_call numeric,
  price_1h numeric,
  price_4h numeric,
  price_24h numeric,
  price_7d numeric,
  raw_text text,
  unique (source_id, message_id)
);
create index on kira_kol_calls (token_address);
create index on kira_kol_calls (source_id, called_at desc);

-- ============================================================
-- RLS POLICIES (summary, per PRD Section 4)
-- ============================================================
-- kira_profiles: user can select/update own row.
-- kira_roster_wallets, kira_alerts, kira_alert_settings: user can CRUD rows where user_id = auth.uid().
-- kira_token_snapshots, kira_wallet_performance: readable by any authenticated user (shared intelligence).
-- kira_wallet_events, kira_watched_addresses, kira_kol_*: service role only. Users never query these
--   directly, the API serves derived views.

alter table kira_profiles enable row level security;
alter table kira_link_codes enable row level security;
alter table kira_roster_wallets enable row level security;
alter table kira_watched_addresses enable row level security;
alter table kira_wallet_events enable row level security;
alter table kira_alerts enable row level security;
alter table kira_alert_settings enable row level security;
alter table kira_token_snapshots enable row level security;
alter table kira_wallet_performance enable row level security;
alter table kira_kol_sources enable row level security;
alter table kira_kol_calls enable row level security;

-- Policy definitions are intentionally left out of this migration for operator review before
-- being applied (per the Sprint 1-2 build spec). Intended policies, to be added in a follow-up
-- migration:
--   kira_profiles: user can select/update own row (auth.uid() = id).
--   kira_roster_wallets, kira_alerts, kira_alert_settings: user can CRUD rows where
--     user_id = auth.uid().
--   kira_token_snapshots, kira_wallet_performance: readable by any authenticated user
--     (shared intelligence).
--   kira_link_codes, kira_wallet_events, kira_watched_addresses, kira_kol_sources, kira_kol_calls:
--     service role only. No policies for authenticated/anon roles, so RLS denies all access by
--     default; the API serves derived views instead of exposing these tables directly.
