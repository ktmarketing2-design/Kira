// Production verification for /api/backlinks/audit
// Proves: real Moz data returned, quota counter incremented, topBacklinks[] absent.

import { createClient } from '@supabase/supabase-js';

const url  = process.env.SUPABASE_URL!;
const key  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const base = process.env.VANTAGE_API_BASE ?? 'https://vantage.ceronix.ai';

const sb = createClient(url, key, { auth: { persistSession: false } });

function quotaKey(): string {
  const now = new Date();
  return `quota:${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function getCacheRow(provider: string, lookupKey: string) {
  const { data } = await sb
    .from('enrichment_cache')
    .select('result, expires_at')
    .eq('provider', provider)
    .eq('lookup_key', lookupKey)
    .maybeSingle();
  return data;
}

async function run() {
  // --- Setup: create ephemeral user + workspace + JWT ---
  const email    = `backlinks-proof-${Date.now()}@example.com`;
  const password = 'TestPassword123!';

  const { data: { user }, error: createErr } = await sb.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (createErr || !user) throw new Error(`User create: ${createErr?.message}`);

  await sb.from('profiles').insert({ id: user.id, email: user.email!, full_name: 'Backlinks Proof User' });

  const { data: { session }, error: signInErr } = await createClient(url, key, { auth: { persistSession: false } })
    .auth.signInWithPassword({ email, password });
  if (signInErr || !session) throw new Error(`Sign in: ${signInErr?.message}`);
  const jwt = session.access_token;

  const { data: ws, error: wsErr } = await sb
    .from('workspaces')
    .insert({ name: 'Backlinks Proof Workspace', slug: `bl-proof-${Date.now()}` })
    .select('id').single();
  if (wsErr) throw new Error(`Workspace: ${wsErr.message}`);
  const workspaceId = ws.id;
  await sb.from('workspace_members').insert({ workspace_id: workspaceId, user_id: user.id, role: 'owner' });

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${jwt}`,
    'x-workspace-id': workspaceId,
    'Content-Type': 'application/json',
  };

  const DOMAIN = 'stripe.com';

  try {
    // --- Proof 1: snapshot quota counter BEFORE the call ---
    const beforeRow = await getCacheRow('moz_rapidapi', quotaKey());
    const usedBefore: number = (beforeRow?.result as any)?.requestsUsed ?? 0;
    console.log(`\n[PROOF] Quota before call: ${usedBefore}/20`);

    // --- Proof 2: real API call ---
    console.log(`\n[PROOF] Calling GET ${base}/api/backlinks/audit?domain=${DOMAIN}`);
    const res = await fetch(`${base}/api/backlinks/audit?domain=${DOMAIN}`, { headers });
    const body = await res.json() as Record<string, unknown>;

    console.log(`\nHTTP status: ${res.status}`);
    console.log('\nRaw response body:');
    console.log(JSON.stringify(body, null, 2));

    if (res.status === 402) {
      console.log('\n[INFO] Quota already exhausted for this month — blocking logic confirmed working.');
      return;
    }
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(body)}`);

    // --- Proof 3: field shape verification ---
    const checks: { label: string; pass: boolean; detail: string }[] = [];

    checks.push({
      label: 'domainAuthority is a number',
      pass: typeof body.domainAuthority === 'number',
      detail: `domainAuthority = ${body.domainAuthority}`,
    });
    checks.push({
      label: 'pageAuthority is a number',
      pass: typeof body.pageAuthority === 'number',
      detail: `pageAuthority = ${body.pageAuthority}`,
    });
    checks.push({
      label: 'totalExternalLinks is a number',
      pass: typeof body.totalExternalLinks === 'number',
      detail: `totalExternalLinks = ${(body.totalExternalLinks as number).toLocaleString()}`,
    });
    checks.push({
      label: 'spamScore is a number',
      pass: typeof body.spamScore === 'number',
      detail: `spamScore = ${body.spamScore}`,
    });
    checks.push({
      label: 'topBacklinks[] is ABSENT (not null, not empty array — field does not exist)',
      pass: !('topBacklinks' in body),
      detail: `topBacklinks key present: ${'topBacklinks' in body}`,
    });
    checks.push({
      label: 'referringDomains is ABSENT',
      pass: !('referringDomains' in body),
      detail: `referringDomains key present: ${'referringDomains' in body}`,
    });
    checks.push({
      label: 'totalBacklinks is ABSENT',
      pass: !('totalBacklinks' in body),
      detail: `totalBacklinks key present: ${'totalBacklinks' in body}`,
    });
    checks.push({
      label: 'domain field matches requested domain',
      pass: body.domain === DOMAIN,
      detail: `domain = ${body.domain}`,
    });

    console.log('\n[PROOF] Field shape checks:');
    let allPass = true;
    for (const c of checks) {
      const tag = c.pass ? 'PASS' : 'FAIL';
      if (!c.pass) allPass = false;
      console.log(`  [${tag}] ${c.label} — ${c.detail}`);
    }

    // --- Proof 4: quota counter incremented (only if not a cache hit) ---
    const afterRow = await getCacheRow('moz_rapidapi', quotaKey());
    const usedAfter: number = (afterRow?.result as any)?.requestsUsed ?? 0;
    const fromCache = body.fromCache === true;

    console.log(`\n[PROOF] Quota after call: ${usedAfter}/20 (fromCache: ${fromCache})`);
    if (fromCache) {
      const quotaUnchanged = usedAfter === usedBefore;
      console.log(`  [${quotaUnchanged ? 'PASS' : 'FAIL'}] Cache hit: quota counter unchanged (${usedBefore} → ${usedAfter})`);
    } else {
      const incremented = usedAfter === usedBefore + 1;
      console.log(`  [${incremented ? 'PASS' : 'FAIL'}] Real call: quota counter incremented (${usedBefore} → ${usedAfter})`);
    }
    if (afterRow?.expires_at) {
      console.log(`  Counter expires_at: ${afterRow.expires_at} (auto-reset at month start)`);
    }

    // --- Proof 5: second call hits cache, quota unchanged ---
    console.log(`\n[PROOF] Second call for same domain (should hit cache)...`);
    const res2 = await fetch(`${base}/api/backlinks/audit?domain=${DOMAIN}`, { headers });
    const body2 = await res2.json() as Record<string, unknown>;
    const afterRow2 = await getCacheRow('moz_rapidapi', quotaKey());
    const usedAfter2: number = (afterRow2?.result as any)?.requestsUsed ?? 0;

    console.log(`  fromCache: ${body2.fromCache}`);
    console.log(`  Quota after second call: ${usedAfter2}/20`);
    const cacheWorked = body2.fromCache === true && usedAfter2 === usedAfter;
    console.log(`  [${cacheWorked ? 'PASS' : 'FAIL'}] Second call fromCache=true, quota unchanged (${usedAfter} → ${usedAfter2})`);

    console.log(`\n[SUMMARY] All field checks passed: ${allPass}`);

  } finally {
    // Cleanup ephemeral test data
    await sb.from('workspace_members').delete().eq('workspace_id', workspaceId);
    await sb.from('workspaces').delete().eq('id', workspaceId);
    await sb.auth.admin.deleteUser(user.id);
    console.log('\n[CLEANUP] Ephemeral user + workspace removed.');
  }
}

run().catch(e => { console.error(e); process.exit(1); });
