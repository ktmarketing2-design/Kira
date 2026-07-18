-- Sprint 10: bug fixes + payments schema.
-- Do not run automatically. Operator runs via the Supabase dashboard or CLI against ccxfetpzllxkoosvzdzd.

-- Bug 3: Watchlist price tracking (so the dashboard Watchlist Snapshot can show real % change
-- instead of dashes).
alter table kira_watchlist add column if not exists price_at_add numeric;

-- Smart wallet real tags (not in the sprint prompt's own migration 014 draft, but needed to
-- support the "display tags as colored badges" request -- kira_smart_wallets had no column to
-- hold GMGN's raw tag list, only the coarse 'category' enum derived from it).
alter table kira_smart_wallets add column if not exists tags text[];

-- Bug 5: KOL notification preferences (Leaderboard per-row toggles currently do nothing).
create table if not exists kira_kol_notification_prefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references kira_profiles(id) on delete cascade,
  source_id uuid not null references kira_kol_sources(id) on delete cascade,
  chart_bubbles boolean not null default true,
  toast boolean not null default true,
  alert_types text[] not null default array['new_call'],
  unique (user_id, source_id)
);
alter table kira_kol_notification_prefs enable row level security;

-- Bug 6: PnL individual trades (History tab currently shows daily snapshots, not real trades).
create table if not exists kira_pnl_trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references kira_profiles(id) on delete cascade,
  wallet_address text not null,
  token_address text not null,
  token_symbol text,
  side text not null,
  token_amount numeric,
  usd_value numeric,
  price_at_trade numeric,
  signature text not null unique,
  traded_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index on kira_pnl_trades (user_id, traded_at desc);
create index on kira_pnl_trades (user_id, wallet_address, traded_at desc);
alter table kira_pnl_trades enable row level security;

-- Payments
create table if not exists kira_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references kira_profiles(id) on delete cascade,
  provider text not null,
  external_id text not null,
  tier text not null,
  amount_usd numeric not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_id)
);
alter table kira_payments enable row level security;

-- Profile payment columns
alter table kira_profiles
  add column if not exists lemonsqueezy_customer_id text,
  add column if not exists lemonsqueezy_subscription_id text;
