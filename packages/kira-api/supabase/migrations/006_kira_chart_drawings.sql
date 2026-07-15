-- Chart Studio drawing persistence.
-- Source of truth: kira-sprint5-claudecode-prompt.md Part 2.
-- Do not run automatically. Operator runs via the Supabase dashboard or CLI.
-- Note: 005 (PnL) is written separately; migrations are independent, run in numeric order.

create table kira_chart_drawings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references kira_profiles(id) on delete cascade,
  token_address text not null,
  drawings jsonb not null default '[]',
  updated_at timestamptz not null default now(),
  unique (user_id, token_address)
);

alter table kira_chart_drawings enable row level security;
-- Intended policy (added in a follow-up migration for operator review): owner can CRUD their own
-- rows (user_id = auth.uid()). The "share" view (GET /chart-drawings/:id, public, no auth) is
-- served by kira-api using the service role, it does not rely on a public-read RLS policy.
