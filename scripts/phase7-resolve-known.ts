// Enqueues resolve jobs for the Factory and Reco signals in the Phase 7 workspace
// (both companies now have their real domains set: factory.ai and reco.ai).
// Run on crnx-core where Redis is on loopback:
//   node --env-file=.env --import tsx/esm scripts/phase7-resolve-known.ts

import { createClient } from '@supabase/supabase-js';
import { resolveQueue } from '@tp/queue';

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const WORKSPACE = 'd50e2f3a-90aa-4e21-afda-d90a68f3b6f6';
const POLL      = 5_000;
const TIMEOUT   = 8 * 60 * 1000;

// Find all signals in the Phase 7 workspace whose company_id is null (waiting for resolve)
const { data: signals } = await sb
  .from('signals')
  .select('id, title')
  .eq('workspace_id', WORKSPACE)
  .is('company_id', null);

console.log('Signals to resolve:', signals?.length);
signals?.forEach(s => console.log(' ', s.id, s.title.slice(0, 55)));

if (!signals?.length) {
  console.log('Nothing to resolve. Exiting.');
  await resolveQueue.close();
  process.exit(0);
}

const since = new Date().toISOString();
for (const sig of signals) {
  const job = await resolveQueue.add('resolve', { workspaceId: WORKSPACE, signalId: sig.id });
  console.log('Enqueued resolve job', job.id, 'for signal', sig.id.slice(0, 8));
}

console.log('\nWaiting for worker to enrich at least one lead with a real name...');
const t0 = Date.now();
let enrichedLead: Record<string, unknown> | null = null;

while (Date.now() - t0 < TIMEOUT) {
  const { data } = await sb
    .from('leads')
    .select('id, status, full_name, title, email, email_status, company_id, created_at')
    .eq('workspace_id', WORKSPACE)
    .eq('status', 'enriched')
    .gt('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1);
  if (data?.length) { enrichedLead = data[0] as Record<string, unknown>; break; }
  process.stdout.write('.');
  await new Promise(r => setTimeout(r, POLL));
}

if (!enrichedLead) {
  // Show whatever leads exist so we can diagnose
  const { data: any } = await sb.from('leads').select('id,status,full_name,created_at')
    .eq('workspace_id', WORKSPACE).gt('created_at', since).order('created_at', { ascending: false }).limit(5);
  console.log('\nNo enriched lead found. Leads created:', JSON.stringify(any));
} else {
  console.log('\n\n=== ENRICHED LEAD ===');
  console.log(JSON.stringify(enrichedLead, null, 2));

  const { data: co } = await sb.from('companies').select('id,name,domain').eq('id', enrichedLead.company_id as string).single();
  console.log('\n=== COMPANY ===');
  console.log(JSON.stringify(co, null, 2));

  // Poll for score
  console.log('\nWaiting for score...');
  const t1 = Date.now();
  while (Date.now() - t1 < 3 * 60 * 1000) {
    const { data: score } = await sb.from('lead_scores').select('*').eq('lead_id', enrichedLead.id as string).maybeSingle();
    if (score) {
      console.log('\n=== LEAD SCORE ===');
      console.log(JSON.stringify(score, null, 2));
      break;
    }
    process.stdout.write('.');
    await new Promise(r => setTimeout(r, POLL));
  }

  const { data: hunter } = await sb.from('api_usage').select('provider,operation,units,cost_usd,created_at')
    .eq('workspace_id', WORKSPACE).eq('provider', 'hunter').gt('created_at', since);
  console.log('\n=== HUNTER api_usage (contact discovery in resolve job) ===');
  console.log(JSON.stringify(hunter, null, 2));
}

await resolveQueue.close();
console.log('\nDone.');
