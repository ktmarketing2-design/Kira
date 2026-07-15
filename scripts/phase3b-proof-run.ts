// Phase 3b proof script: run the news_rss adapter inline against the live
// Google News RSS feed and verify the four proof requirements.
//
// Usage: node --env-file=.env --import tsx/esm scripts/phase3b-proof-run.ts

import { createClient } from '@supabase/supabase-js';
import { newsRssAdapter } from '../packages/sources/src/adapters/news-rss.js';
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

// ---- seed (idempotent) ------------------------------------------------------

let { data: ws } = await sb
  .from('workspaces')
  .select('id')
  .eq('slug', 'phase3b-news-rss')
  .maybeSingle();

if (!ws) {
  const { data, error } = await sb
    .from('workspaces')
    .insert({ name: 'Phase 3b - News RSS', slug: 'phase3b-news-rss' })
    .select('id')
    .single();
  if (error) throw new Error(`seed workspace: ${error.message}`);
  ws = data;
  console.log('Created workspace:', ws!.id);
} else {
  console.log('Reusing workspace:', ws.id);
}
const workspaceId = ws!.id as string;

let { data: src } = await sb
  .from('signal_sources')
  .select('id')
  .eq('workspace_id', workspaceId)
  .eq('adapter', 'news_rss')
  .maybeSingle();

if (!src) {
  const { data, error } = await sb
    .from('signal_sources')
    .insert({
      workspace_id: workspaceId,
      kind: 'news',
      adapter: 'news_rss',
      config: {
        queries: ['Series A funding raised SaaS'],
        signalType: 'funding',
        maxPerQuery: 25,
      },
      is_enabled: true,
    })
    .select('id')
    .single();
  if (error) throw new Error(`seed source: ${error.message}`);
  src = data;
  console.log('Created signal_source:', src!.id);
} else {
  console.log('Reusing signal_source:', src.id);
}
const sourceId = src!.id as string;

// ---- inline pipeline --------------------------------------------------------

function makeCtx(wid: string) {
  return {
    workspaceId: wid,
    recordUsage: (p: Parameters<typeof db.recordApiUsage>[1]) =>
      db.recordApiUsage(wid, p),
    cacheGet: db.cacheGet.bind(db),
    cacheSet: db.cacheSet.bind(db),
    logger: {
      info: (m: string, x?: unknown) => console.log('[news_rss]', m, x ?? ''),
      error: (m: string, x?: unknown) => console.error('[news_rss]', m, x ?? ''),
    },
  };
}

async function runDiscover(label: string): Promise<{ runId: string; inserted: number; found: number }> {
  console.log(`\n--- ${label} ---`);
  const source = await db.getSignalSource(sourceId);
  const ctx = makeCtx(workspaceId);
  const run = await db.startSourceRun(sourceId);
  console.log('source_run started:', run.id);

  const raw = await newsRssAdapter.discover(source.config, ctx);
  console.log('Adapter returned', raw.length, 'signals');

  let inserted = 0;
  for (const s of raw) {
    const created = await db.upsertSignal(workspaceId, sourceId, s);
    if (created) inserted++;
  }

  await db.finishSourceRun(run.id, { found: raw.length, inserted });
  return { runId: run.id, inserted, found: raw.length };
}

// ---- run 1 ------------------------------------------------------------------

const run1 = await runDiscover('Run 1');

const { data: run1Row } = await sb
  .from('source_runs')
  .select('id, status, signals_found, signals_new, started_at, finished_at')
  .eq('id', run1.runId)
  .single();
log('PROOF 1 - source_runs row for run 1', run1Row);

const { data: sample } = await sb
  .from('signals')
  .select('id, type, title, fingerprint, domain, source_id, discovered_at')
  .eq('workspace_id', workspaceId)
  .eq('type', 'funding')
  .order('discovered_at', { ascending: false })
  .limit(1);
log('PROOF 2 - sample signals row (type=funding, fingerprint populated)', sample?.[0] ?? null);

// Show raw scraped fields for the sample so it is visible the data came from the feed.
if (sample?.[0]) {
  const { data: rawRow } = await sb
    .from('signals')
    .select('raw')
    .eq('id', sample[0].id)
    .single();
  log('PROOF 2b - raw scraped fields for that signal', rawRow?.raw ?? null);
}

const { count: countAfterRun1 } = await sb
  .from('signals')
  .select('id', { count: 'exact', head: true })
  .eq('workspace_id', workspaceId);
console.log(`\nTotal signals in workspace after run 1: ${countAfterRun1}`);

// ---- run 2: dedup -----------------------------------------------------------

const run2 = await runDiscover('Run 2 (dedup check - cache cleared to force re-fetch)');

// Clear the cache entry so run 2 re-fetches from Google News and hits upsert
// dedup, proving the fingerprint constraint holds against real DB rows.
await sb
  .from('enrichment_cache')
  .delete()
  .eq('provider', 'news_rss')
  .like('lookup_key', 'query:%');

const run2Clear = await runDiscover('Run 2 (cache cleared, re-fetching live)');

const { data: run2Row } = await sb
  .from('source_runs')
  .select('id, status, signals_found, signals_new, started_at, finished_at')
  .eq('id', run2Clear.runId)
  .single();

const { count: countAfterRun2 } = await sb
  .from('signals')
  .select('id', { count: 'exact', head: true })
  .eq('workspace_id', workspaceId);

log('PROOF 3 (= original proof 4) - source_runs row for re-run (signals_new should be 0)', run2Row);
console.log(`\nSignals before re-run: ${countAfterRun1}`);
console.log(`Signals after  re-run: ${countAfterRun2}`);
console.log(countAfterRun1 === countAfterRun2
  ? 'DEDUP CONFIRMED: signal count unchanged on re-run.'
  : `WARNING: count changed by ${(countAfterRun2 ?? 0) - (countAfterRun1 ?? 0)}`);

console.log('\nPhase 3b proof run complete.');
