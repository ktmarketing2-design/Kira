-- Sprint 7 Part 1: GMGN Deep Intel columns on kira_token_snapshots.
-- Do not run automatically. Operator runs via the Supabase dashboard or CLI against ccxfetpzllxkoosvzdzd.
--
-- wash_trade and rug_ratio are included per the original spec's column list but are NOT
-- currently populated by kira-workers: neither field exists anywhere in GMGN's real
-- 'token info' or 'token security' responses (checked live against BONK before this was
-- written -- the actual response fields are open_source/honeypot/renounced_mint/
-- renounced_freeze_account/buy_tax/sell_tax, no wash_trade or rug_ratio anywhere). Left as
-- nullable columns for a future source rather than dropped, since the sprint doc named them
-- explicitly, but every row will have them null until something actually populates them.

alter table kira_token_snapshots
  add column if not exists smart_degen_count int,
  add column if not exists renowned_wallets int,
  add column if not exists rat_trader_rate numeric,
  add column if not exists bundler_rate numeric,
  add column if not exists sniper_count int,
  add column if not exists fresh_wallet_rate numeric,
  add column if not exists dev_holding_pct numeric,
  add column if not exists rug_ratio numeric,
  add column if not exists wash_trade boolean;
