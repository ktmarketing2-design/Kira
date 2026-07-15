import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

async function run() {
  const { data: campaignLeads } = await sb.from('campaign_leads').select('*');
  console.log('campaign_leads:', campaignLeads);
  const { data: leads } = await sb.from('leads').select('id, email, status');
  console.log('leads:', leads);
  const { data: companies } = await sb.from('companies').select('id, name');
  console.log('companies:', companies);
}

run().catch(console.error);
