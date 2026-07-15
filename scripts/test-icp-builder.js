import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

async function run() {
  console.log('1. Creating temporary auth user...');
  const email = `test-icp-${Date.now()}@example.com`;
  const password = 'TestPassword123!';
  const { data: userData, error: userError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (userError || !userData.user) {
    console.error('Failed to create user:', userError);
    return;
  }

  const user = userData.user;
  console.log(`   User created: ${user.id}`);

  console.log('2. Inserting profile...');
  const { error: profileError } = await supabase.from('profiles').insert({
    id: user.id,
    email: user.email,
    full_name: 'Test ICP User'
  });
  if (profileError) {
    console.error('Failed to create profile:', profileError);
    await supabase.auth.admin.deleteUser(user.id);
    return;
  }

  console.log('3. Creating temporary workspace and membership...');
  const workspaceId = crypto.randomUUID();
  
  const { error: wsError } = await supabase.from('workspaces').insert({
    id: workspaceId,
    name: 'Ephemeral Test Workspace',
    slug: `ephemeral-test-workspace-${Date.now()}`
  });
  if (wsError) {
    console.error('Failed to create workspace:', wsError);
    await supabase.from('profiles').delete().eq('id', user.id);
    await supabase.auth.admin.deleteUser(user.id);
    return;
  }

  const { error: memberError } = await supabase.from('workspace_members').insert({
    workspace_id: workspaceId,
    user_id: user.id,
    role: 'owner'
  });
  if (memberError) {
    console.error('Failed to create membership:', memberError);
    await supabase.from('workspaces').delete().eq('id', workspaceId);
    await supabase.from('profiles').delete().eq('id', user.id);
    await supabase.auth.admin.deleteUser(user.id);
    return;
  }
  console.log(`   Workspace & membership created: ${workspaceId}`);

  console.log('3. Logging in to obtain access token...');
  const { data: sessionData, error: loginError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (loginError || !sessionData.session) {
    console.error('Login failed:', loginError);
    // Cleanup
    await supabase.from('workspace_members').delete().eq('workspace_id', workspaceId);
    await supabase.from('workspaces').delete().eq('id', workspaceId);
    await supabase.from('profiles').delete().eq('id', user.id);
    await supabase.auth.admin.deleteUser(user.id);
    return;
  }

  const token = sessionData.session.access_token;
  console.log('   Access token obtained successfully.');

  console.log('4. Calling POST /api/discovery/icp-builder on production URL...');
  try {
    const response = await fetch('https://vantage.ceronix.ai/api/discovery/icp-builder', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'x-workspace-id': workspaceId,
      },
      body: JSON.stringify({ offer: 'I sell lawn mowing services in London' }),
    });

    console.log(`   Response Status: ${response.status} ${response.statusText}`);
    const body = await response.json();
    console.log('   Response Body:');
    console.log(JSON.stringify(body, null, 2));
  } catch (apiError) {
    console.error('   API Request failed:', apiError);
  }

  console.log('5. Cleaning up ephemeral data...');
  await supabase.from('workspace_members').delete().eq('workspace_id', workspaceId);
  await supabase.from('workspaces').delete().eq('id', workspaceId);
  await supabase.from('profiles').delete().eq('id', user.id);
  await supabase.auth.admin.deleteUser(user.id);
  console.log('   Cleanup done.');
}

run().catch(console.error);
