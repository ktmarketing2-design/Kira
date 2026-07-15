import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const sb = createClient(url, key, { auth: { persistSession: false } });

async function test() {
  console.log('Starting API route messages test...');

  // 1. Create a real test user
  const email = `test-api-messages-${Date.now()}@example.com`;
  const password = 'TestPassword123!';
  const { data: { user }, error: createErr } = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr || !user) throw new Error(`User create error: ${createErr?.message}`);

  await sb.from('profiles').insert({ id: user.id, email: user.email!, full_name: 'API Messages Test User' });

  // 2. Sign in to get a real signed JWT
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { data: { session }, error: signInErr } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (signInErr || !session) throw new Error(`Sign in error: ${signInErr?.message}`);
  const jwt = session.access_token;

  // 3. Create workspace + member link
  const { data: ws, error: wsErr } = await sb.from('workspaces').insert({
    name: 'API Messages Workspace',
    slug: `api-msg-ws-${Date.now()}`,
  }).select('id').single();
  if (wsErr) throw new Error(`Workspace error: ${wsErr.message}`);
  const workspaceId = ws.id;

  await sb.from('workspace_members').insert({ workspace_id: workspaceId, user_id: user.id, role: 'member' });

  // 4. Create dummy company, lead, and outreach message
  const { data: company } = await sb.from('companies').insert({
    workspace_id: workspaceId,
    name: 'API Messages Co',
  }).select('id').single();

  const { data: lead } = await sb.from('leads').insert({
    workspace_id: workspaceId,
    company_id: company!.id,
    full_name: 'Lead to Test Route',
    email: 'test-lead-route@example.com',
    email_status: 'verified',
    status: 'enriched',
  }).select('id').single();
  const leadId = lead!.id;

  const { data: campaign } = await sb.from('campaigns').insert({
    workspace_id: workspaceId,
    name: 'API Messages Campaign',
  }).select('id').single();

  const { data: message, error: msgErr } = await sb.from('outreach_messages').insert({
    workspace_id: workspaceId,
    campaign_id: campaign!.id,
    lead_id: leadId,
    direction: 'outbound',
    channel: 'email',
    subject: 'Verification of route param passing',
    body: '<p>Param verified!</p>',
    generated_by: 'gemini',
    context_used: {},
  }).select('id, subject, body').single();
  console.log('seeded message:', message, 'error:', msgErr);

  // 5. Perform the GET request to vantage-api
  const targetUrl = `http://127.0.0.1:4010/api/leads/${leadId}/messages`;
  console.log(`Hitting endpoint: GET ${targetUrl}`);
  console.log(`With x-workspace-id header: ${workspaceId}`);

  const res = await fetch(targetUrl, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'x-workspace-id': workspaceId,
    },
  });

  console.log(`HTTP status code: ${res.status}`);
  const data = await res.json() as { messages?: any[]; error?: string };
  console.log('Response body:', JSON.stringify(data, null, 2));

  if (res.status !== 200) {
    throw new Error(`Expected status 200, got ${res.status}. Error: ${data.error}`);
  }

  if (!data.messages || data.messages.length === 0) {
    throw new Error('Expected messages list, got empty or undefined');
  }

  const returnedMessage = data.messages[0];
  if (returnedMessage.id !== message!.id) {
    throw new Error(`Returned message ID ${returnedMessage.id} did not match expected ID ${message!.id}`);
  }

  console.log('\nSUCCESS: Express route parameter threading verified. :leadId resolves correctly inside sub-mounted route handler!');

  // 6. Cleanup
  console.log('Cleaning up seeded test DB rows...');
  await sb.from('outreach_messages').delete().eq('workspace_id', workspaceId);
  await sb.from('campaigns').delete().eq('workspace_id', workspaceId);
  await sb.from('leads').delete().eq('workspace_id', workspaceId);
  await sb.from('companies').delete().eq('workspace_id', workspaceId);
  await sb.from('workspace_members').delete().eq('workspace_id', workspaceId);
  await sb.from('workspaces').delete().eq('id', workspaceId);
  await sb.auth.admin.deleteUser(user.id);
  console.log('Cleanup complete!');
}

test().catch(console.error);
