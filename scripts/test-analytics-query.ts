import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

async function run() {
  const email = 'phase7-proof@vantage.test';
  const password = 'TestPassword123!';
  const workspaceId = '73564578-bfbc-4355-aebe-ec2d64664672'; // Phase 3b - News RSS workspace

  const { data: authData, error: authErr } = await sb.auth.signInWithPassword({ email, password });
  if (authErr) throw authErr;

  const token = authData.session?.access_token;
  const res = await fetch('http://127.0.0.1:4010/api/analytics/funnel', {
    headers: {
      'x-workspace-id': workspaceId,
      Authorization: `Bearer ${token}`,
    },
  });

  const body = await res.json();
  console.log('--- FUNNEL ANALYTICS DATA FROM REAL QUERY ---');
  console.log(JSON.stringify(body, null, 2));
}

run().catch(console.error);
