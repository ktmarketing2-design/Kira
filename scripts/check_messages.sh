#!/usr/bin/env bash
set -euo pipefail

DATABASE_URL=$(grep -E "^DATABASE_URL=" /var/www/vantage/.env | cut -d"=" -f2- | tr -d "\"" | tr -d "\r")
/usr/bin/psql "$DATABASE_URL" -c "\d campaign_leads"
/usr/bin/psql "$DATABASE_URL" -c "select id, campaign_id, lead_id, status from campaign_leads;"
/usr/bin/psql "$DATABASE_URL" -c "select id, campaign_id, lead_id, sent_at, provider_msg_id from outreach_messages;"
