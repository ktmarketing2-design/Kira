#!/usr/bin/env bash
set -euo pipefail

DATABASE_URL=$(grep -E "^DATABASE_URL=" /var/www/vantage/.env | cut -d"=" -f2- | tr -d "\"" | tr -d "\r")
/usr/bin/psql "$DATABASE_URL" -c "select distinct jsonb_object_keys(result->'raw'->'person'->'organization') from enrichment_cache where provider = 'apollo';"
