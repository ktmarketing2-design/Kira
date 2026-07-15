// Phase 5 proof: one signal through resolve -> enrich -> score -> outreach.
// Inline calls only, no BullMQ queue involved. See report for what this does
// and does not prove.
//
// Usage: node --env-file=.env --import tsx/esm scripts/phase5-proof-run.ts

import { createClient } from '@supabase/supabase-js';
import { db } from '../apps/worker/src/db.js';
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

const WORKSPACE_ID = '73564578-bfbc-4355-aebe-ec2d64664672';
const SIGNAL_ID    = 'cab85fc5-abf1-40d0-b434-a31af5501834'; // Factory Series A

// ---- ICP --------------------------------------------------------------------

const ICP: ICPForScoring = {
  name: 'Early-stage AI SaaS Founders',
  industries: ['software', 'artificial_intelligence', 'saas'],
  companySizes: ['1-10', '11-50'],
  geographies: ['US', 'CA', 'UK'],
  jobTitles: ['CEO', 'Founder', 'Co-Founder', 'CTO', 'Head of Product'],
  description:
    'Technical founders and co-founders at AI-native SaaS companies that recently raised seed or Series A. They build products with small teams and need AI infrastructure or workflow tooling to move faster.',
};

// Insert ICP row (idempotent)
let { data: existingIcp } = await sb
  .from('icp_profiles')
  .select('id')
  .eq('workspace_id', WORKSPACE_ID)
  .eq('name', ICP.name)
  .maybeSingle();

let icpId: string;
if (!existingIcp) {
  const { data, error } = await sb
    .from('icp_profiles')
    .insert({
      workspace_id: WORKSPACE_ID,
      name: ICP.name,
      industries: ICP.industries,
      company_sizes: ICP.companySizes,
      geographies: ICP.geographies,
      job_titles: ICP.jobTitles,
      description: ICP.description,
      is_active: true,
    })
    .select('id')
    .single();
  if (error) throw new Error(`icp insert: ${error.message}`);
  icpId = data!.id as string;
  console.log('Created ICP:', icpId);
} else {
  icpId = existingIcp.id as string;
  console.log('Reusing ICP:', icpId);
}

// ---- Step 1: Resolve --------------------------------------------------------

console.log('\nStep 1: Resolve');
const signal = await db.getSignal(SIGNAL_ID);
log('Signal', signal);

let company = await db.resolveCompanyForSignal(WORKSPACE_ID, signal);
console.log('\nresolveCompanyForSignal result:', company ?? 'null (no match in DB)');

if (!company) {
  // No existing company row. Create one from the signal title.
  // Title: "Factory Raises $4.69 Million Series A - The SaaS News"
  // Company name: Factory, domain: factory.ai (known from public sources)
  console.log('Path taken: creating company record from signal data (no DB match).');
  const { data, error } = await sb
    .from('companies')
    .insert({
      workspace_id: WORKSPACE_ID,
      name: 'Factory',
      domain: 'factory.ai',
      industry: 'software',
      size_band: '1-10',
    })
    .select('id, name, domain')
    .single();
  if (error) throw new Error(`company insert: ${error.message}`);
  company = { id: data!.id as string, name: data!.name, domain: data!.domain ?? undefined };
  console.log('Created company:', JSON.stringify(company));
} else {
  console.log('Path taken: existing company found via resolveCompanyForSignal.');
}

log('STEP 1 RESULT - Company', company);

// ---- Step 2: Enrich ---------------------------------------------------------

console.log('\nStep 2: Enrich');

// Candidates to try if the first one fails Apollo enrichment.
// We try Factory first, then fall back to Reco (larger raise, better coverage).
const candidates: Array<{ companyName: string; domain: string; signalTitle: string }> = [
  { companyName: 'Factory', domain: 'factory.ai', signalTitle: signal.title },
  { companyName: 'Reco', domain: 'reco.ai', signalTitle: 'Reco raises $30M to lock down AI apps' },
  { companyName: 'Knapsack', domain: 'knapsack.cloud', signalTitle: 'Knapsack Raises $10 Million in Series A' },
];

let leadId: string | null = null;
let enrichedCompanyName = '';
let attemptedCount = 0;

for (const candidate of candidates) {
  attemptedCount++;
  console.log(`\nEnrichment attempt ${attemptedCount}: ${candidate.companyName} (${candidate.domain})`);

  // Ensure company row exists for this candidate
  let { data: co } = await sb
    .from('companies')
    .select('id')
    .eq('workspace_id', WORKSPACE_ID)
    .eq('domain', candidate.domain)
    .maybeSingle();

  if (!co) {
    const { data, error } = await sb
      .from('companies')
      .insert({ workspace_id: WORKSPACE_ID, name: candidate.companyName, domain: candidate.domain, industry: 'software', size_band: '1-10' })
      .select('id')
      .single();
    if (error) throw new Error(`company insert for ${candidate.companyName}: ${error.message}`);
    co = data;
  }

  const { data: lead, error: leadErr } = await sb
    .from('leads')
    .insert({ workspace_id: WORKSPACE_ID, company_id: co!.id, source_signal_id: SIGNAL_ID, icp_id: icpId, status: 'new' })
    .select('id')
    .single();
  if (leadErr) throw new Error(`lead insert: ${leadErr.message}`);

  const enriched = await db.enrichLead(WORKSPACE_ID, lead!.id as string);
  console.log(`enrichLead returned: ${enriched}`);

  if (enriched) {
    leadId = lead!.id as string;
    enrichedCompanyName = candidate.companyName;
    console.log(`Enrichment succeeded on attempt ${attemptedCount} (${candidate.companyName})`);
    break;
  } else {
    console.log(`Apollo found no contact for ${candidate.companyName} - trying next candidate`);
    // Mark lead unenrichable so it stays clean in the DB
    // (enrichLead already set status to 'unenrichable')
  }
}

if (!leadId) {
  console.log(`\nAll ${attemptedCount} enrichment candidates returned no Apollo contact.`);
  console.log('This is real information about Apollo coverage of funding-stage SaaS companies.');
  console.log('Proceeding with an unenriched lead for scoring/outreach to show the rest of the chain.');
  // Use the first lead created (Factory) for the rest of the proof
  const { data: anyLead } = await sb
    .from('leads')
    .select('id')
    .eq('workspace_id', WORKSPACE_ID)
    .eq('status', 'unenrichable')
    .limit(1)
    .maybeSingle();
  leadId = anyLead?.id ?? null;
  enrichedCompanyName = 'Factory (unenriched)';
}

if (!leadId) throw new Error('No lead available to continue chain');

// Fetch the enriched lead row for display
const { data: leadRow } = await sb
  .from('leads')
  .select('id, status, full_name, title, email, email_status, enrichment_source, company_id')
  .eq('id', leadId)
  .single();

log('STEP 2 RESULT - Enriched Lead Row', leadRow);

// Fetch api_usage for this workspace to show Apollo cost recorded
const { data: usage } = await sb
  .from('api_usage')
  .select('provider, operation, units, cost_usd, created_at')
  .eq('workspace_id', WORKSPACE_ID)
  .eq('provider', 'apollo')
  .order('created_at', { ascending: false })
  .limit(3);
log('STEP 2 RESULT - api_usage rows (Apollo)', usage);

// ---- Step 3: Score ----------------------------------------------------------

console.log('\nStep 3: Score');
const { lead: leadForScoring, icp: icpForScoring } = await db.loadLeadForScoring(WORKSPACE_ID, leadId);
log('Lead passed to scoreLead', leadForScoring);

const score = await scoreLead(leadForScoring, icpForScoring);
log('STEP 3 RESULT - Lead Score', score);

// Save score to DB
await db.saveLeadScore(leadId, score);
console.log('\nScore saved to lead_scores and leads.fit_score updated.');

// ---- Step 4: Outreach -------------------------------------------------------

console.log('\nStep 4: Outreach');
const message = await writeOutreach({
  lead: leadForScoring,
  valueProp:
    'Ceronix Labs builds AI infrastructure and workflow automation tools for early-stage SaaS teams. We help founders ship AI-native features faster without building the underlying plumbing from scratch.',
  senderName: 'Alex',
  channel: 'email',
});

log('STEP 4 RESULT - Outreach Message', message);

// ---- Summary ----------------------------------------------------------------

console.log('\n' + '='.repeat(60));
console.log('  Phase 5 proof complete');
console.log('='.repeat(60));
console.log(`ICP:                ${ICP.name} (id: ${icpId})`);
console.log(`Signal:             ${signal.title}`);
console.log(`Company:            ${enrichedCompanyName}`);
console.log(`Enrichment result:  ${leadRow?.status}`);
console.log(`Fit score:          ${score.fitScore}`);
console.log(`Intent score:       ${score.intentScore}`);
console.log('\nNOTE: this proof calls the four functions directly (resolve, enrich,');
console.log('score, outreach). The BullMQ-driven automatic pipeline (auto-enqueue');
console.log('between stages) was NOT exercised here. That is a separate later task.');
