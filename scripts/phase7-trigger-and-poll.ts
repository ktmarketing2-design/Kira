// Phase 7 proof trigger: run this ON crnx-core (local Redis accessible).
// Enqueues one discover job, polls the DB until the full chain completes,
// then prints evidence for every stage.
//
// Usage (on crnx-core, from /var/www/vantage):
//   node --env-file=.env --import tsx/esm scripts/phase7-trigger-and-poll.ts
//
// The script does NOT call discover/enrich/score itself. It only enqueues the
// discover job and watches the DB. All processing is done by vantage-worker.

import { createClient } from '@supabase/supabase-js';
import { discoverQueue } from '@tp/queue';

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const WORKSPACE_ID = '73564578-bfbc-4355-aebe-ec2d64664672';
const SOURCE_ID    = '1807c05b-5562-44f6-9928-247ce0bcb4d6';
const POLL_MS      = 5_000;
const TIMEOUT_MS   = 10 * 60 * 1000; // 10 min

function log(label: string, obj: unknown) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${label}`);
  console.log('='.repeat(60));
  console.log(JSON.stringify(obj, null, 2));
}

// ---- run 1: full chain ------------------------------------------------------

console.log('Phase 7 proof — run 1 (full chain)');
console.log('Workspace:', WORKSPACE_ID);
console.log('Source:   ', SOURCE_ID);

// Clear any stale proof leads from prior manual runs so we can see fresh rows.
// Only delete leads created after the Phase 5/6 inline proof; leave factory.ai
// leads untouched (company already exists, we want a clean signal/lead pair).
const beforeRun1 = new Date();

const job1 = await discoverQueue.add('discover', { workspaceId: WORKSPACE_ID, sourceId: SOURCE_ID });
console.log(`\nDiscover job enqueued (BullMQ id: ${job1.id}) at`, beforeRun1.toISOString());
console.log('Waiting for vantage-worker to process the full chain...');

// Poll for a completed source_run newer than beforeRun1
const start = Date.now();
let run1Id: string | null = null;

while (Date.now() - start < TIMEOUT_MS) {
  const { data } = await sb
    .from('source_runs')
    .select('id, status, signals_found, signals_new, started_at, finished_at, error')
    .eq('source_id', SOURCE_ID)
    .in('status', ['completed', 'failed'])
    .gt('started_at', beforeRun1.toISOString())
    .order('started_at', { ascending: false })
    .limit(1);

  if (data?.length) {
    run1Id = data[0].id as string;
    break;
  }
  process.stdout.write('.');
  await new Promise(r => setTimeout(r, POLL_MS));
}
if (!run1Id) throw new Error('Timed out waiting for source_run to complete');

const { data: run1 } = await sb.from('source_runs').select('*').eq('id', run1Id).single();
log('PROOF 1 — source_runs row (worker processed discover)', run1);

if (run1?.status === 'failed') {
  console.error('Discover run FAILED:', run1.error);
  process.exit(1);
}

// Wait for at least one lead to reach 'enriched' or 'unenrichable' status,
// meaning the resolve -> discover -> enrich chain completed without our help.
console.log('\nWaiting for resolve -> contact-discovery -> enrich chain to complete...');
const chainStart = Date.now();
let enrichedLead: Record<string, unknown> | null = null;

while (Date.now() - chainStart < TIMEOUT_MS) {
  const { data } = await sb
    .from('leads')
    .select('id, status, full_name, title, email, email_status, company_id, created_at')
    .eq('workspace_id', WORKSPACE_ID)
    .in('status', ['enriched', 'unenrichable'])
    .gt('created_at', beforeRun1.toISOString())
    .order('created_at', { ascending: false })
    .limit(1);

  if (data?.length) {
    enrichedLead = data[0] as Record<string, unknown>;
    break;
  }
  process.stdout.write('.');
  await new Promise(r => setTimeout(r, POLL_MS));
}

if (!enrichedLead) {
  console.log('\nNo enriched/unenrichable lead appeared within timeout.');
  // Show what signals were created so we can diagnose
  const { data: sigs } = await sb
    .from('signals')
    .select('id, title, status, company_id, discovered_at')
    .eq('workspace_id', WORKSPACE_ID)
    .gt('discovered_at', beforeRun1.toISOString())
    .limit(5);
  log('New signals (for diagnosis)', sigs);
  process.exit(1);
}

log('PROOF 2 — lead row after worker ran resolve + contact-discovery + enrich', enrichedLead);

// Show the company that was resolved
const { data: company } = await sb
  .from('companies')
  .select('id, name, domain')
  .eq('id', enrichedLead.company_id as string)
  .maybeSingle();
log('PROOF 2b — resolved company', company);

// Wait for score if lead is enriched
let scoreRow: Record<string, unknown> | null = null;
if (enrichedLead.status === 'enriched') {
  console.log('\nLead is enriched — waiting for score job to complete...');
  const scoreStart = Date.now();
  while (Date.now() - scoreStart < 3 * 60 * 1000) {
    const { data } = await sb
      .from('lead_scores')
      .select('lead_id, fit_score, intent_score, rationale, created_at')
      .eq('lead_id', enrichedLead.id as string)
      .maybeSingle();
    if (data) { scoreRow = data as Record<string, unknown>; break; }
    process.stdout.write('.');
    await new Promise(r => setTimeout(r, POLL_MS));
  }
  log('PROOF 3 — lead_scores row (worker ran score without our help)', scoreRow ?? 'not yet scored');
}

// Hunter api_usage proof
const { data: hunterUsage } = await sb
  .from('api_usage')
  .select('provider, operation, units, created_at')
  .eq('workspace_id', WORKSPACE_ID)
  .eq('provider', 'hunter')
  .gt('created_at', beforeRun1.toISOString())
  .order('created_at', { ascending: false })
  .limit(5);
log('PROOF 4 — api_usage rows for Hunter (contact discovery during resolve)', hunterUsage);

// ---- run 2: dedup -----------------------------------------------------------

console.log('\n' + '='.repeat(60));
console.log('  Run 2: dedup check');
console.log('='.repeat(60));

const { count: leadsBefore } = await sb
  .from('leads')
  .select('id', { count: 'exact', head: true })
  .eq('workspace_id', WORKSPACE_ID);
const { count: sigsBefore } = await sb
  .from('signals')
  .select('id', { count: 'exact', head: true })
  .eq('workspace_id', WORKSPACE_ID);

const beforeRun2 = new Date();
const job2 = await discoverQueue.add('discover', { workspaceId: WORKSPACE_ID, sourceId: SOURCE_ID });
console.log(`\nRun 2 enqueued (BullMQ id: ${job2.id})`);

// Wait for run 2 source_run to complete
const run2start = Date.now();
let run2Id: string | null = null;
while (Date.now() - run2start < TIMEOUT_MS) {
  const { data } = await sb
    .from('source_runs')
    .select('id, status, signals_found, signals_new')
    .eq('source_id', SOURCE_ID)
    .in('status', ['completed', 'failed'])
    .gt('started_at', beforeRun2.toISOString())
    .order('started_at', { ascending: false })
    .limit(1);
  if (data?.length) { run2Id = data[0].id as string; break; }
  process.stdout.write('.');
  await new Promise(r => setTimeout(r, POLL_MS));
}
if (!run2Id) throw new Error('Timed out waiting for run 2');

const { data: run2 } = await sb.from('source_runs').select('id, status, signals_found, signals_new').eq('id', run2Id).single();
const { count: leadsAfter } = await sb.from('leads').select('id', { count: 'exact', head: true }).eq('workspace_id', WORKSPACE_ID);
const { count: sigsAfter } = await sb.from('signals').select('id', { count: 'exact', head: true }).eq('workspace_id', WORKSPACE_ID);

log('PROOF 5 — source_runs row for run 2 (signals_new should be 0)', run2);
console.log(`\nSignals before run 2: ${sigsBefore} | after: ${sigsAfter}`);
console.log(`Leads   before run 2: ${leadsBefore} | after: ${leadsAfter}`);
console.log(sigsAfter === sigsBefore && leadsAfter === leadsBefore
  ? 'DEDUP CONFIRMED: no new signals or leads created on run 2.'
  : 'WARNING: counts changed — check for fingerprint gaps.');

await discoverQueue.close();

console.log('\n' + '='.repeat(60));
console.log('  Phase 7 proof complete');
console.log('='.repeat(60));
console.log('All stages driven by vantage-worker, no manual function calls.');
