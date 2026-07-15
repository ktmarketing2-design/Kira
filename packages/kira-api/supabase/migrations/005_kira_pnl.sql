-- Daily PnL Digest.
-- Source of truth: kira-sprint5-claudecode-prompt.md Part 4.
-- Do not run automatically. Operator runs via the Supabase dashboard or CLI.

create table kira_pnl_wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references kira_profiles(id) on delete cascade,
  address text not null,
  label text,
  chain text not null default 'solana',
  created_at timestamptz not null default now(),
  unique (user_id, address)
);

create table kira_pnl_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references kira_profiles(id) on delete cascade,
  wallet_address text not null,
  date date not null,
  realized_pnl_usd numeric,
  unrealized_pnl_usd numeric,
  total_trades int,
  winning_trades int,
  top_gainer_symbol text,
  top_gainer_pct numeric,
  top_loser_symbol text,
  top_loser_pct numeric,
  computed_at timestamptz not null default now(),
  unique (user_id, wallet_address, date)
);
create index on kira_pnl_snapshots (user_id, date desc);

alter table kira_pnl_wallets enable row level security;
alter table kira_pnl_snapshots enable row level security;
-- Intended policy (added in a follow-up migration for operator review): owner can CRUD
-- kira_pnl_wallets and read kira_pnl_snapshots where user_id = auth.uid(). The digest worker
-- writes snapshots via the service role, which bypasses RLS.
