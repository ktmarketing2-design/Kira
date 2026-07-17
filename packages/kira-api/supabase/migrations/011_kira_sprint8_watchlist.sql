-- Sprint 8 Part 2: Watchlist.
-- Do not run automatically. Operator runs via the Supabase dashboard or CLI against ccxfetpzllxkoosvzdzd.
--
-- Scoped to just the watchlist table for this part of Sprint 8. Research Notes (Part 5) gets its
-- own later migration file rather than being bundled in here, matching this project's convention
-- of one migration file per shipped unit of work (each of 004-010 landed as its own file).

create table kira_watchlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references kira_profiles(id) on delete cascade,
  token_address text not null,
  token_symbol text,
  token_name text,
  added_at timestamptz not null default now(),
  notes text,
  unique (user_id, token_address)
);
create index on kira_watchlist (user_id, added_at desc);
alter table kira_watchlist enable row level security;
