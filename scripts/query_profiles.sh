#!/usr/bin/env bash
set -euo pipefail

DATABASE_URL=$(grep -E "^DATABASE_URL=" /var/www/vantage/.env | cut -d"=" -f2- | tr -d "\"" | tr -d "\r")
/usr/bin/psql "$DATABASE_URL" -c "select id, email, full_name from profiles;"
/usr/bin/psql "$DATABASE_URL" -c "select id, name, slug from workspaces;"
/usr/bin/psql "$DATABASE_URL" -c "select id, email, encrypted_password from auth.users;"
/usr/bin/psql "$DATABASE_URL" -c "select workspace_id, user_id, role from workspace_members;"
