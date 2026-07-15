#!/usr/bin/env bash
set -euo pipefail

DATABASE_URL=$(grep -E "^DATABASE_URL=" /var/www/vantage/.env | cut -d"=" -f2- | tr -d "\"" | tr -d "\r")
/usr/bin/psql "$DATABASE_URL" -c "
  delete from signals where workspace_id = '73564578-bfbc-4355-aebe-ec2d64664672';
  delete from leads where workspace_id = '73564578-bfbc-4355-aebe-ec2d64664672';
  delete from companies where workspace_id = '73564578-bfbc-4355-aebe-ec2d64664672';
"
