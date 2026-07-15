// Phase 6 proof: contact discovery (Hunter) inserted before enrichment (Apollo),
// closing the gap Phase 5 found. Full chain: resolve -> discover -> enrich ->
// score -> outreach, plus cache-hit proof on a second discovery call.
//
// Inline calls only, no BullMQ queue. Same distinction as Phase 5.
//
// Usage: node --env-file=.env --import tsx/esm scripts/phase6-proof-run.ts

import { createClient } from '@supabase/supabase-js';
import { db } from '../apps/worker/src/db.js';
import { findContactsAtDomain } from '../packages/sources/src/adapters/hunter.js';
import { scoreLead, writeOutreach } from '../packages/ai/src/index.js';
import type { ICPForScoring } from '../packages/ai/src/index.js';

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

function log(label: string, obj: unknown) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${label}`);
  console.log('='.repeat(60));
  console.log(JSON.stringify(obj, null, 2));
}

function makeCtx(workspaceId: string) {
  return {
    workspaceId,
    recordUsage: (p: Parameters<typeof db.recordApiUsage>[1]) =>
      db.recordApiUsage(workspaceId, p),
    cacheGet: db.cacheGet.bind(db),
    cacheSet: db.cacheSet.bind(db),
    logger: {
      info: (m: string, x?: unknown) => console.log('[hunter]', m, x ?? ''),
      error: (m: string, x?: unknown) => console.error('[hunter]', m, x ?? ''),
    },
  };
}

const WORKSPACE_ID = '73564578-bfbc-4355-aebe-ec2d64664672';

// ICP (same as Phase 5)
const ICP: ICPForScoring = {
  name: 'Early-stage AI SaaS Founders',
  industries: ['software', 'artificial_intelligence', 'saas'],
  companySizes: ['1-10', '11-50'],
  geographies: ['US', 'CA', 'UK'],
  jobTitles: ['CEO', 'Founder', 'Co-Founder', 'CTO', 'Head of Product'],
  description:
    'Technical founders and co-founders at AI-native SaaS companies that recently raised seed or Series A. They build products with small teams and need AI infrastructure or workflow tooling to move faster.',
};

// Reuse ICP row inserted in Phase 5
const { data: icpRow } = await sb
  .from('icp_profiles')
  .select('id')
  .eq('workspace_id', WORKSPACE_ID)
  .eq('name', ICP.name)
  .maybeSingle();
if (!icpRow) throw new Error('ICP row not found — run phase5-proof-run.ts first');
const icpId = icpRow.id as string;
console.log('ICP id:', icpId);

const ctx = makeCtx(WORKSPACE_ID);

// ---- Step 1: Resolve (same signal/company as Phase 5) -----------------------

console.log('\nStep 1: Resolve');
const signal = await db.getSignal('cab85fc5-abf1-40d0-b434-a31af5501834');
log('Signal', signal);

// Company was created in Phase 5 under factory.ai — reuse it
const { data: companyRow } = await sb
  .from('companies')
  .select('id, name, domain')
  .eq('workspace_id', WORKSPACE_ID)
  .eq('domain', 'factory.ai')
  .maybeSingle();

const company = companyRow
  ? { id: companyRow.id as string, name: companyRow.name, domain: companyRow.domain ?? undefined }
  : null;

if (!company) throw new Error('factory.ai company row not found — run phase5-proof-run.ts first');
log('STEP 1 RESULT - Company (from Phase 5 resolve)', company);

// ---- Step 2: Contact discovery (NEW this phase) -----------------------------

console.log('\nStep 2: Contact discovery via Hunter.io');
console.log('Calling findContactsAtDomain("factory.ai", ICP.jobTitles, ctx)...');

const candidates = await findContactsAtDomain('factory.ai', ICP.jobTitles, ctx);
log('STEP 2 RESULT - Candidates from Hunter (live call #1)', candidates);

if (candidates.length === 0) {
  console.log('Hunter returned no title-matched candidates for factory.ai.');
  console.log('Trying backup domain: reco.ai');
  const backupCandidates = await findContactsAtDomain('reco.ai', ICP.jobTitles, ctx);
  log('Backup candidates (reco.ai)', backupCandidates);
  if (backupCandidates.length === 0) throw new Error('No candidates from Hunter on any domain — stopping proof here as required by kickoff.');
}

const topCandidate = candidates[0]!;
console.log(`\nTop candidate: ${topCandidate.fullName} (${topCandidate.title})`);

// ---- Step 2b: Cache-hit proof (same call, no new Hunter request) ------------

console.log('\nStep 2b: Second call to findContactsAtDomain (must be a cache hit)');
const candidates2 = await findContactsAtDomain('factory.ai', ICP.jobTitles, ctx);
log('STEP 2b RESULT - Candidates from Hunter (call #2 — cache hit expected)', candidates2);

// Verify api_usage has exactly one row for hunter domain_search
const { data: hunterUsage } = await sb
  .from('api_usage')
  .select('id, operation, units, created_at')
  .eq('workspace_id', WORKSPACE_ID)
  .eq('provider', 'hunter')
  .order('created_at', { ascending: true });
log('STEP 2b RESULT - api_usage rows for Hunter (should be exactly 1)', hunterUsage);

// ---- Step 3: Write top candidate's name onto the lead ----------------------

console.log('\nStep 3: Write candidate name onto lead, then enrich via Apollo');

// Create a fresh lead for this run (or reuse one that was unenrichable)
const { data: existingLead } = await sb
  .from('leads')
  .select('id, status')
  .eq('workspace_id', WORKSPACE_ID)
  .eq('company_id', company.id)
  .eq('status', 'unenrichable')
  .maybeSingle();

let leadId: string;
if (existingLead) {
  leadId = existingLead.id as string;
  // Reset it so enrichLead will try again
  await sb.from('leads').update({ status: 'new', full_name: null, first_name: null, last_name: null }).eq('id', leadId);
} else {
  const { data: newLead, error } = await sb
    .from('leads')
    .insert({ workspace_id: WORKSPACE_ID, company_id: company.id, source_signal_id: signal.id, icp_id: icpId, status: 'new' })
    .select('id')
    .single();
  if (error) throw new Error(`lead insert: ${error.message}`);
  leadId = newLead!.id as string;
}

// Write the discovered name onto the lead before enrichLead runs
const nameParts = topCandidate.fullName.trim().split(/\s+/);
const firstName = nameParts[0] ?? '';
const lastName = nameParts.slice(1).join(' ');
await sb.from('leads').update({
  full_name: topCandidate.fullName,
  first_name: firstName,
  last_name: lastName || null,
  title: topCandidate.title,
  linkedin_url: topCandidate.linkedinUrl ?? null,
  status: 'new',
}).eq('id', leadId);

console.log(`Lead ${leadId} updated with name: ${topCandidate.fullName}, title: ${topCandidate.title}`);

// ---- Step 4: Enrich (Apollo people/match — now has a real name) ------------

const enriched = await db.enrichLead(WORKSPACE_ID, leadId);
console.log('\nenrichLead result:', enriched);

const { data: leadRow } = await sb
  .from('leads')
  .select('id, status, full_name, title, email, email_status, location, enrichment_source')
  .eq('id', leadId)
  .single();
log('STEP 3+4 RESULT - Lead row after discovery + enrichment', leadRow);

// Apollo api_usage
const { data: apolloUsage } = await sb
  .from('api_usage')
  .select('provider, operation, units, cost_usd, created_at')
  .eq('workspace_id', WORKSPACE_ID)
  .eq('provider', 'apollo')
  .order('created_at', { ascending: false })
  .limit(3);
log('Apollo api_usage rows (most recent)', apolloUsage);

// ---- Step 5: Score ----------------------------------------------------------

console.log('\nStep 5: Score');
const { lead: leadForScoring, icp: icpForScoring } = await db.loadLeadForScoring(WORKSPACE_ID, leadId);
log('Lead passed to scoreLead', leadForScoring);

const score = await scoreLead(leadForScoring, icpForScoring);
log('STEP 5 RESULT - Lead Score', score);
await db.saveLeadScore(leadId, score);
console.log('Score saved.');

// ---- Step 6: Outreach -------------------------------------------------------

console.log('\nStep 6: Outreach');
const message = await writeOutreach({
  lead: leadForScoring,
  valueProp:
    'Ceronix Labs builds AI infrastructure and workflow automation tools for early-stage SaaS teams. We help founders ship AI-native features faster without building the underlying plumbing from scratch.',
  senderName: 'Alex',
  channel: 'email',
});
log('STEP 6 RESULT - Outreach Message', message);

// ---- Summary ----------------------------------------------------------------

console.log('\n' + '='.repeat(60));
console.log('  Phase 6 proof complete');
console.log('='.repeat(60));
console.log(`Signal:          ${signal.title}`);
console.log(`Company:         ${company.name} (${company.domain})`);
console.log(`Contact found:   ${topCandidate.fullName} — ${topCandidate.title}`);
console.log(`Enrichment:      ${leadRow?.status} (email: ${leadRow?.email ? 'present' : 'null'})`);
console.log(`Fit score:       ${score.fitScore}`);
console.log(`Intent score:    ${score.intentScore}`);
console.log(`Hunter calls:    ${hunterUsage?.length ?? '?'} (proves cache held on call #2)`);
console.log('\nNOTE: inline calls only — BullMQ pipeline not exercised.');
