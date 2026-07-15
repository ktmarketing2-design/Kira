// Phase 3 proof script: run the discover pipeline inline against the live
// Apify API, writing signals and api_usage rows via the real data layer.
//
// NOTE: this script exercises discovery and storage only. The resolve-queue
// fan-out (signal -> company -> lead) is part of the worker's BullMQ pipeline
// and is not exercised here. Phase 3 proves discovery and storage, not the
// full pipeline dispatch.
//
// The inline path calls exactly the same logic as the worker's discover job
// handler (adapter.discover -> db.startSourceRun -> db.upsertSignal ->
// db.finishSourceRun), just invoked directly instead of via BullMQ, because
// Redis is on crnx-core's loopback and is not reachable from local dev.
//
// Usage: node --env-file=.env --import tsx/esm scripts/phase3-discover-run.ts

import { createClient } from '@supabase/supabase-js';
import { apifyAdapter } from '../packages/sources/src/adapters/apify.js';
import { db } from '../apps/worker/src/db.js';

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

function log(label: string, obj: unknown) {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(obj, null, 2));
}

// Minimal AdapterContext matching the contract in packages/sources/src/types.ts.
// Mirrors what apps/worker/src/context.ts produces, without importing that
// file (it's Antigravity-owned).
function makeCtx(workspaceId: string) {
  return {
    workspaceId,
    recordUsage: (p: { provider: string; operation: string; units?: number; costUsd?: number }) =>
      db.recordApiUsage(workspaceId, p),
    cacheGet: db.cacheGet.bind(db),
    cacheSet: db.cacheSet.bind(db),
    logger: {
      info: (m: string, x?: unknown) => console.log('[apify]', m, x ?? ''),
      error: (m: string, x?: unknown) => console.error('[apify]', m, x ?? ''),
    },
  };
}

// Reuse the rows seeded earlier (workspace + source already in the DB).
const workspaceId = 'aba839a4-ebda-4239-8c25-f678815d5953';
const sourceId    = 'e13fd30e-2adc-4a75-a046-5672a2fb9b48';

async function runDiscover(label: string): Promise<string> {
  console.log(`\n--- ${label} ---`);
  const source = await db.getSignalSource(sourceId);
  const ctx = makeCtx(workspaceId);

  const run = await db.startSourceRun(sourceId);
  console.log('source_run started:', run.id);

  const raw = await apifyAdapter.discover(source.config, ctx);
  console.log('Apify returned', raw.length, 'items');

  let inserted = 0;
  for (const s of raw) {
    const created = await db.upsertSignal(workspaceId, sourceId, s);
    if (created) inserted++;
  }

  await db.finishSourceRun(run.id, { found: raw.length, inserted });
  console.log(`finishSourceRun: found=${raw.length} inserted=${inserted}`);
  return run.id;
}

// ---- run 1 ------------------------------------------------------------------

const run1Id = await runDiscover('Run 1');

const { data: run1 } = await sb
  .from('source_runs')
  .select('id, status, signals_found, signals_new, error, started_at, finished_at')
  .eq('id', run1Id)
  .single();
log('PROOF 1 - source_runs row for run 1', run1);

const { data: sampleSignal } = await sb
  .from('signals')
  .select('id, type, title, fingerprint, domain, source_id, discovered_at')
  .eq('workspace_id', workspaceId)
  .eq('source_id', sourceId)
  .eq('type', 'hiring')
  .order('discovered_at', { ascending: false })
  .limit(1);
log('PROOF 2 - sample signals row (type=hiring, fingerprint populated)', sampleSignal?.[0] ?? null);

const { count: countAfterRun1 } = await sb
  .from('signals')
  .select('id', { count: 'exact', head: true })
  .eq('workspace_id', workspaceId);
console.log(`\nTotal signals in workspace after run 1: ${countAfterRun1}`);

const { data: usageRow } = await sb
  .from('api_usage')
  .select('id, workspace_id, provider, operation, units, cost_usd, created_at')
  .eq('workspace_id', workspaceId)
  .eq('provider', 'apify')
  .order('created_at', { ascending: false })
  .limit(1);
log('PROOF 3 - api_usage row (provider=apify)', usageRow?.[0] ?? null);

// ---- run 2: dedup -----------------------------------------------------------

const run2Id = await runDiscover('Run 2 (dedup check)');

const { data: run2 } = await sb
  .from('source_runs')
  .select('id, status, signals_found, signals_new, error, started_at, finished_at')
  .eq('id', run2Id)
  .single();

const { count: countAfterRun2 } = await sb
  .from('signals')
  .select('id', { count: 'exact', head: true })
  .eq('workspace_id', workspaceId);

log('PROOF 4 - source_runs row for run 2 (signals_new should be 0)', run2);
console.log(`\nSignals before run 2: ${countAfterRun1}`);
console.log(`Signals after  run 2: ${countAfterRun2}`);
console.log(countAfterRun1 === countAfterRun2
  ? 'DEDUP CONFIRMED: signal count unchanged between run 1 and run 2.'
  : `WARNING: count changed by ${(countAfterRun2 ?? 0) - (countAfterRun1 ?? 0)}`);

console.log('\nPhase 3 proof run complete.');
console.log('NOTE: resolve-queue fan-out (signal -> company -> lead) is handled');
console.log('by the worker on crnx-core and is not exercised in this script.');
console.log('Phase 3 proves discovery and storage only, not full pipeline dispatch.');
