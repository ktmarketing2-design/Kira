#!/usr/bin/env bash
set -euo pipefail

DATABASE_URL=$(grep -E "^DATABASE_URL=" /var/www/vantage/.env | cut -d"=" -f2- | tr -d "\"" | tr -d "\r")
/usr/bin/psql "$DATABASE_URL" -c "
  do \$\$
  begin
    if not exists (select 1 from pg_type where typname = 'sender_provider') then
      create type sender_provider as enum ('brevo', 'sendgrid', 'smtp', 'gmail_oauth');
    end if;
    if not exists (select 1 from pg_type where typname = 'sender_status') then
      create type sender_status as enum ('active', 'invalid', 'suspended', 'disconnected');
    end if;
  end \$\$;

  create table if not exists workspace_senders (
    id              uuid primary key default gen_random_uuid(),
    workspace_id    uuid not null references workspaces(id) on delete cascade,
    provider        sender_provider not null,
    status          sender_status not null default 'active',
    from_name       text not null,
    from_email      citext not null,
    credentials_enc bytea not null,
    is_default      boolean not null default true,
    last_used_at    timestamptz,
    last_error      text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
  );

  do \$\$
  begin
    if not exists (select 1 from pg_indexes where indexname = 'idx_workspace_senders_ws') then
      create index idx_workspace_senders_ws on workspace_senders(workspace_id);
    end if;
  end \$\$;

  alter table workspace_senders enable row level security;

  do \$\$
  begin
    if not exists (select 1 from pg_policies where policyname = 'ws_member_select_ws_senders') then
      create policy ws_member_select_ws_senders on workspace_senders
        for select using (is_workspace_member(workspace_id));
    end if;
    if not exists (select 1 from pg_policies where policyname = 'ws_member_all_ws_senders') then
      create policy ws_member_all_ws_senders on workspace_senders
        for all using (is_workspace_member(workspace_id))
        with check (is_workspace_member(workspace_id));
    end if;
  end \$\$;

  alter table campaigns add column if not exists sender_id uuid references workspace_senders(id) on delete set null;
"
