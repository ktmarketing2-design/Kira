-- Sprint 6 Part 3: Smart Money Digest.
-- Renumbered from the sprint prompt's suggested 007: 007 was already taken by
-- 007_alerts_filter_fk_on_delete_set_null.sql, and 008 by 008_kira_sprint6_kol.sql (both from
-- earlier in this same sprint). Do not run automatically. Operator runs via the Supabase
-- dashboard or CLI against ccxfetpzllxkoosvzdzd.

create table if not exists kira_smart_wallets (
  address text primary key,
  label text not null,
  category text not null,                 -- 'whale' | 'dex_trader' | 'early_buyer' | 'fund'
  win_rate_30d numeric,
  avg_return_30d numeric,
  last_computed_at timestamptz,
  is_verified boolean not null default false,
  added_at timestamptz not null default now()
);

create table if not exists kira_smart_money_events (
  id bigint generated always as identity primary key,
  wallet_address text not null references kira_smart_wallets(address),
  token_address text not null,
  side text not null,                     -- 'buy' | 'sell'
  usd_value numeric,
  block_time timestamptz not null,
  signature text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists kira_smart_money_events_token_time_idx on kira_smart_money_events (token_address, block_time desc);
create index if not exists kira_smart_money_events_wallet_time_idx on kira_smart_money_events (wallet_address, block_time desc);

-- Starter seed list: only 2 rows, not the 20-30 the spec called for.
-- Every other 'known profitable Solana wallet' candidate found via web search this session
-- either had no address attached to a name (just a platform username on GMGN/Kolscan/Birdeye,
-- not a resolvable on-chain address), or came from a single unverified search snippet. Both
-- addresses below were independently confirmed via a live Helius getSignaturesForAddress call
-- (real, actively transacting accounts, not fabricated) before being added here. Fabricating
-- addresses to hit a round number would put wrong data in a feature literally named for trust
-- (smart money), so this seed is intentionally small and honest rather than padded.
-- Grow this list from a trusted source (a GMGN/Birdeye/Dune leaderboard export, or the
-- operator's own vetted list) rather than more ad-hoc web search.
insert into kira_smart_wallets (address, label, category, is_verified) values
  ('GV6UUmNxz2RpKxmNAPadYKb7uQpszwqQAu3qLJxVdC52', 'Ansem (@blknoiz06)', 'early_buyer', true),
  ('suqh5sHtr8HyJ7q8scBimULPkPpA557prMG47xCHQfK', 'Cupsey', 'dex_trader', true)
on conflict (address) do nothing;
