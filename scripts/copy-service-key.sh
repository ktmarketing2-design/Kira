#!/usr/bin/env bash
set -euo pipefail

SERVICE_KEY=$(grep -E "^SUPABASE_SERVICE_ROLE_KEY=" /var/www/vantage/.env | cut -d"=" -f2- | tr -d "\"" | tr -d "\r")
sed -i "s|VITE_SUPABASE_ANON_KEY=.*|VITE_SUPABASE_ANON_KEY=$SERVICE_KEY|" /var/www/vantage/apps/web/.env

GEMINI_KEY=$(grep -E "^GEMINI_API_KEY=" /var/www/vantage/.env | cut -d"=" -f2- | tr -d "\"" | tr -d "\r")
sed -i "s|GEMINI_API_KEY=.*|GEMINI_API_KEY=$GEMINI_KEY|" /var/www/vantage/apps/web/.env

cd /var/www/vantage/apps/web
npm run build
