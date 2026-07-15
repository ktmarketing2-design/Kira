#!/usr/bin/env bash
set -euo pipefail

DATABASE_URL=$(grep -E "^DATABASE_URL=" /var/www/vantage/.env | cut -d"=" -f2- | tr -d "\"" | tr -d "\r")
/usr/bin/psql "$DATABASE_URL" -c "
  create table if not exists unsubscribed_emails (
    email       citext primary key,
    created_at  timestamptz not null default now()
  );
"
