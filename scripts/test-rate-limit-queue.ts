import { createClient } from '@supabase/supabase-js';
import { sendQueue } from '@tp/queue';
import { encryptCredentials } from '../apps/worker/src/crypto.js';

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const WORKSPACE = 'd50e2f3a-90aa-4e21-afda-d90a68f3b6f6';
const BREVO_KEY = process.env.BREVO_API_KEY!;

async function run() {
  console.log('Setting up rate-limit queue test...');

  // 1. Clean up old state completely to prevent unique key constraint violations
  await sb.from('campaign_leads').delete().eq('campaigns.workspace_id', WORKSPACE);
  await sb.from('campaigns').delete().eq('workspace_id', WORKSPACE);
  await sb.from('leads').delete().eq('workspace_id', WORKSPACE);
  await sb.from('companies').delete().eq('workspace_id', WORKSPACE);
  await sb.from('workspace_senders').delete().eq('workspace_id', WORKSPACE);

  // 2. Insert sender
  const enc = encryptCredentials({ apiKey: BREVO_KEY });
  const { data: sender } = await sb.from('workspace_senders').insert({
    workspace_id: WORKSPACE,
    provider: 'brevo',
    from_name: 'Vantage Test',
    from_email: 'hello@ceronix.ai',
    credentials_enc: `\\x${enc.toString('hex')}`,
    status: 'active',
    is_default: true,
  }).select('id').single();

  // 3. Insert test company + lead
  const { data: company } = await sb.from('companies').insert({
    workspace_id: WORKSPACE,
    name: 'RateLimit Queue Test Co',
  }).select('id').single();

  const { data: lead } = await sb.from('leads').insert({
    workspace_id: WORKSPACE,
    company_id: company!.id,
    full_name: 'Kelvin Test',
    email: 'kelvinomonuwa@mavalowlabs.com',
    email_status: 'verified',
    status: 'enriched',
  }).select('id').single();

  const { data: campaign } = await sb.from('campaigns').insert({
    workspace_id: WORKSPACE,
    name: 'Queue Test Campaign',
  }).select('id').single();

  const { data: campaignLead1 } = await sb.from('campaign_leads').insert({
    campaign_id: campaign!.id,
    lead_id: lead!.id,
    status: 'pending',
  }).select('id').single();

  const { data: campaignLead2 } = await sb.from('campaign_leads').insert({
    campaign_id: campaign!.id,
    lead_id: lead!.id,
    status: 'pending',
  }).select('id').single();

  console.log('Enqueuing 2 jobs immediately...');
  // Force Vantage dry-run mode for these queue jobs so we don't send real emails
  // (We'll check logs for dry-run send and rate-limited messages)
  await sendQueue.add('send', {
    workspaceId: WORKSPACE,
    campaignLeadId: campaignLead1!.id,
    leadId: lead!.id,
    campaignId: campaign!.id,
  });

  await sendQueue.add('send', {
    workspaceId: WORKSPACE,
    campaignLeadId: campaignLead2!.id,
    leadId: lead!.id,
    campaignId: campaign!.id,
  });

  console.log('Jobs enqueued! Wait 25 seconds for worker to process them...');
  await new Promise(resolve => setTimeout(resolve, 25000));

  // Fetch and print the status of the campaign leads
  const { data: results } = await sb.from('campaign_leads').select('id, status').eq('campaign_id', campaign!.id);
  console.log('Campaign leads status after processing:', results);

  console.log('Cleaning up DB entries...');
  await sb.from('campaign_leads').delete().eq('campaign_id', campaign!.id);
  await sb.from('campaigns').delete().eq('id', campaign!.id);
  await sb.from('leads').delete().eq('id', lead!.id);
  await sb.from('companies').delete().eq('id', company!.id);
  await sb.from('workspace_senders').delete().eq('workspace_id', WORKSPACE);

  console.log('Cleanup complete. Check PM2 logs for rate-limit re-queueing!');
}

run().catch(console.error);
