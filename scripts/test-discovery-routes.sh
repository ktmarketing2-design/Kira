#!/usr/bin/env bash
# Smoke-test the /api/discovery routes against the deployed server.
# Usage: TOKEN=<supabase_access_token> WS=<workspace_id> bash scripts/test-discovery-routes.sh
#
# You can get TOKEN from localStorage.getItem('sb-<ref>-auth-token') in browser DevTools
# (the access_token field). WS is the workspace UUID shown in the network tab.

set -e

BASE="${API_BASE:-https://vantage.ceronix.ai}"
TOKEN="${TOKEN:?TOKEN env var required}"
WS="${WS:?WS (workspace_id) env var required}"

auth=(-H "Authorization: Bearer $TOKEN" -H "x-workspace-id: $WS" -H "Content-Type: application/json")

echo "=== 1. POST /api/discovery/runs ==="
RUN=$(curl -sf -X POST "$BASE/api/discovery/runs" \
  "${auth[@]}" \
  -d '{"icp":{"industries":["dental clinic"],"geos":["Lagos, NG"]}}')
echo "$RUN" | python3 -m json.tool 2>/dev/null || echo "$RUN"
RUN_ID=$(echo "$RUN" | python3 -c "import sys,json; print(json.load(sys.stdin)['runId'])" 2>/dev/null || echo "")
echo "Run ID: $RUN_ID"

echo ""
echo "=== 2. GET /api/discovery/runs/:runId ==="
curl -sf "$BASE/api/discovery/runs/$RUN_ID" "${auth[@]}" | python3 -m json.tool 2>/dev/null

echo ""
echo "=== 3. GET /api/discovery/runs/:runId/prospects (may be empty if pending) ==="
curl -sf "$BASE/api/discovery/runs/$RUN_ID/prospects" "${auth[@]}" | python3 -m json.tool 2>/dev/null

echo ""
echo "=== 4. PATCH /api/discovery/prospects/:id/status (skip if no prospects yet) ==="
echo "   Run: curl -X PATCH $BASE/api/discovery/prospects/<prospect_id>/status"
echo '        -H "Authorization: Bearer $TOKEN" -H "x-workspace-id: $WS"'
echo '        -H "Content-Type: application/json" -d '"'"'{"status":"qualified"}'"'"

echo ""
echo "=== 5. GET /api/discovery/runs/:runId/prospects/export ==="
echo "   Run: curl -o prospects.csv $BASE/api/discovery/runs/$RUN_ID/prospects/export ${auth[*]}"
