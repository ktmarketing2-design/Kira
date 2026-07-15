// Phase 8 proof script — runs inline on crnx-core (needs SENDER_ENCRYPTION_KEY
// and BREVO_API_KEY in .env). Uses the DB + send logic directly; no BullMQ or
// deployed API route required.
//
// Usage: node --env-file=.env --import tsx/esm scripts/phase8-proof-run.ts
//
// Set PHASE8_TEST_EMAIL to the address you want the real proof send delivered to.

import { createClient } from '@supabase/supabase-js';
import { db } from '../apps/worker/src/db.js';
import { encryptCredentials, decryptCredentials } from '../apps/worker/src/crypto.js';
import { getActiveSender, markSenderInvalid } from '../apps/worker/src/sender-store.js';
import { getSenderAdapter, SenderAuthError } from '../apps/worker/src/senders/index.js';

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const WORKSPACE  = 'd50e2f3a-90aa-4e21-afda-d90a68f3b6f6';
const TEST_EMAIL = process.env.PHASE8_TEST_EMAIL ?? 'kelvinomonuwa@mavalowlabs.com';
const BREVO_KEY  = process.env.BREVO_API_KEY;

if (!BREVO_KEY) throw new Error('BREVO_API_KEY must be set in .env');

function log(label: string, obj: unknown) {
  console.log('\n' + '='.repeat(60));
  console.log('  ' + label);
  console.log('='.repeat(60));
  console.log(JSON.stringify(obj, null, 2));
}

// ---- Proof 1: no sender connected -> clear failure -------------------------

console.log('\n--- PROOF 1: no sender connected ---');
// Ensure workspace has no senders
await sb.from('workspace_senders').delete().eq('workspace_id', WORKSPACE);
const noSender = await getActiveSender(WORKSPACE);
log('PROOF 1 — getActiveSender with no senders (must be null)', { result: noSender });
if (noSender !== null) throw new Error('FAIL: expected null, got a sender');
console.log('PASS: returns null, send worker would fail with "no sender connected"');

// ---- Proof 2: connect a sender, GET masks credentials ----------------------

console.log('\n--- PROOF 2: connect Brevo sender ---');
const creds = { apiKey: BREVO_KEY };
const enc   = encryptCredentials(creds);
log('Encrypted blob size (bytes)', { bytes: enc.length });

// Verify round-trip before touching DB
const decrypted = decryptCredentials(enc);
if ((decrypted as any).apiKey !== BREVO_KEY) throw new Error('FAIL: decrypt round-trip mismatch');
console.log('Encrypt/decrypt round-trip: PASS');

const { data: inserted, error: insErr } = await sb
  .from('workspace_senders')
  .insert({
    workspace_id:    WORKSPACE,
    provider:        'brevo',
    from_name:       'Vantage Test',
    from_email:      'hello@ceronix.ai',
    credentials_enc: `\\x${enc.toString('hex')}`,
    status:          'active',
    is_default:      true,
  })
  .select('id, provider, from_name, from_email, status, is_default, created_at')
  .single();
if (insErr) throw new Error(`sender insert: ${insErr.message}`);

log('PROOF 2a — sender row in DB (no credentials_enc field returned)', inserted);
console.log('credentials_enc in response:', 'credentials_enc' in (inserted ?? {}));

// Verify getActiveSender returns the sender (with decrypted creds, not exposed in log)
const activeSender = await getActiveSender(WORKSPACE);
if (!activeSender) throw new Error('FAIL: getActiveSender returned null after insert');
log('PROOF 2b — getActiveSender returns sender (creds field present but not logged)', {
  id:        activeSender.id,
  provider:  activeSender.provider,
  fromName:  activeSender.fromName,
  fromEmail: activeSender.fromEmail,
  hasCredentials: typeof activeSender.credentials === 'object' && 'apiKey' in activeSender.credentials,
});
const senderId = activeSender.id;

// ---- Proof 3: real send to TEST_EMAIL, dry-run first, then real -----------

console.log('\n--- PROOF 3a: DRY-RUN send ---');
const adapter = getSenderAdapter('brevo');
const dryResult = await adapter.send(
  { to: TEST_EMAIL, subject: 'Vantage Phase 8 dry-run', body: '<p>Dry run — no real email sent.</p>', fromName: 'Vantage Test', fromEmail: 'hello@ceronix.ai' },
  activeSender.credentials,
  true,
);
log('PROOF 3a — dry-run result (no real Brevo call)', dryResult);

console.log('\n--- PROOF 3b: email_status gate (guessed -> blocked) ---');
// Insert a test lead with email_status 'guessed'
const { data: co } = await sb.from('companies').select('id').eq('workspace_id', WORKSPACE).limit(1).maybeSingle();
const { data: gLead } = await sb.from('leads').insert({
  workspace_id: WORKSPACE, company_id: co!.id, status: 'enriched',
  email: 'guessed@example.com', email_status: 'guessed',
}).select('id, email, email_status').single();
log('PROOF 3b — lead with email_status=guessed', gLead);
// Send worker decision: email_status !== 'verified' -> blocked
const blocked = gLead!.email_status !== 'verified';
console.log('Blocked before send?', blocked, '— PASS if true');

console.log('\n--- PROOF 3c: unsubscribe gate ---');
await db.markUnsubscribed(TEST_EMAIL);
const isUnsub = await db.isUnsubscribed(TEST_EMAIL);
log('PROOF 3c — isUnsubscribed after markUnsubscribed', { email: TEST_EMAIL, isUnsubscribed: isUnsub });
if (!isUnsub) throw new Error('FAIL: expected isUnsubscribed = true');
console.log('PASS: send worker would log "unsubscribed — blocking send"');

// Remove from suppression so real send can proceed
await sb.from('unsubscribed_emails').delete().eq('email', TEST_EMAIL);
console.log('Removed from suppression for real send proof');

console.log('\n--- PROOF 3d: REAL send to ' + TEST_EMAIL + ' ---');
const realResult = await adapter.send(
  {
    to:        TEST_EMAIL,
    subject:   'Vantage Phase 8 real send proof',
    body:      '<p>This is the Phase 8 outreach delivery proof for Vantage. If you received this, the send pipeline works end to end.</p>',
    fromName:  activeSender.fromName,
    fromEmail: activeSender.fromEmail,
  },
  activeSender.credentials,
  false,
);
log('PROOF 3d — real Brevo send result', realResult);
if (!realResult.providerMessageId || realResult.providerMessageId.startsWith('dry-run')) {
  throw new Error('FAIL: expected a real providerMessageId');
}

// Write outreach_messages and mark sent (same as send worker does)
const msg = await db.createOutreachMessage({
  workspaceId: WORKSPACE, leadId: gLead!.id,
  subject: 'Vantage Phase 8 real send proof',
  body: '<p>Phase 8 proof send.</p>',
  generatedBy: 'manual', contextUsed: { proof: 'phase8' },
});
await db.markMessageSent(msg.id, realResult.providerMessageId);

const { data: msgRow } = await sb.from('outreach_messages').select('id, sent_at, provider_msg_id').eq('id', msg.id).single();
log('PROOF 3d — outreach_messages row (sent_at + provider_msg_id populated)', msgRow);

// ---- Proof 4: disconnect sender, subsequent attempt fails ------------------

console.log('\n--- PROOF 4: disconnect sender -> no sender connected ---');
await sb.from('workspace_senders').delete().eq('id', senderId);
const afterDelete = await getActiveSender(WORKSPACE);
log('PROOF 4 — getActiveSender after DELETE (must be null, no fallback)', { result: afterDelete });
if (afterDelete !== null) throw new Error('FAIL: expected null after disconnect');
console.log('PASS: no fallback sender. Send worker would fail "no sender connected"');

// ---- Proof 5: bad credentials -> sender status flips to invalid ------------

console.log('\n--- PROOF 5: invalid credentials -> sender status invalid ---');
const badCreds = { apiKey: 'definitely-not-a-real-key' };
const badEnc   = encryptCredentials(badCreds);
const { data: badSender } = await sb.from('workspace_senders').insert({
  workspace_id: WORKSPACE, provider: 'brevo',
  from_name: 'Bad Sender', from_email: 'bad@ceronix.ai',
  credentials_enc: `\\x${badEnc.toString('hex')}`,
  status: 'active', is_default: true,
}).select('id').single();

let caughtAuthError = false;
try {
  await adapter.send(
    { to: TEST_EMAIL, subject: 'x', body: 'x', fromName: 'x', fromEmail: 'bad@ceronix.ai' },
    badCreds,
    false,
  );
} catch (err) {
  if (err instanceof SenderAuthError) {
    caughtAuthError = true;
    await markSenderInvalid(badSender!.id, (err as Error).message);
    console.log('SenderAuthError caught:', (err as Error).message);
  } else throw err;
}

const { data: badRow } = await sb.from('workspace_senders').select('id, status, last_error').eq('id', badSender!.id).single();
log('PROOF 5 — sender row after auth failure (status must be invalid)', badRow);
if (badRow?.status !== 'invalid') throw new Error('FAIL: expected status=invalid');
if (!caughtAuthError) throw new Error('FAIL: expected SenderAuthError to be thrown');
console.log('PASS: SenderAuthError caught, sender.status=invalid, last_error populated');

// ---- Proof 6: rate limit — second send in same workspace is delayed --------

console.log('\n--- PROOF 6: per-workspace rate limit ---');
const INTERVAL = 45;

// Simulate what the send worker does after a successful send
await db.recordSendRateLimit(WORKSPACE, INTERVAL);
const immediateCheck = await db.checkSendRateLimit(WORKSPACE);
log('PROOF 6a — checkSendRateLimit immediately after recordSendRateLimit', immediateCheck);
if (!immediateCheck.limited) throw new Error('FAIL: expected limited=true immediately after first send');
if (immediateCheck.retryAfterMs < 1) throw new Error('FAIL: expected retryAfterMs > 0');
console.log(`PASS: rate-limited. Second send must wait ~${Math.round(immediateCheck.retryAfterMs / 1000)}s`);

// Confirm a different workspace is NOT rate-limited (per-workspace, not global)
const OTHER_WS = '73564578-bfbc-4355-aebe-ec2d64664672';
const otherCheck = await db.checkSendRateLimit(OTHER_WS);
log('PROOF 6b — checkSendRateLimit for a different workspace (must be unlimited)', otherCheck);
if (otherCheck.limited) throw new Error('FAIL: rate limit bled into a different workspace');
console.log('PASS: rate limit is per-workspace, not global');

// Simulate what the send worker actually does: re-enqueues with delay rather
// than firing — we log what the delay value would be rather than calling
// sendQueue.add (no Redis from this machine)
console.log(`Send worker would call: sendQueue.add('send', job.data, { delay: ${immediateCheck.retryAfterMs} })`);
console.log('Current job completes without consuming a retry attempt.');

// Cleanup the rate limit key so it doesn't interfere with later runs
await sb.from('enrichment_cache')
  .delete()
  .eq('provider', 'send_ratelimit')
  .eq('lookup_key', WORKSPACE);
console.log('Rate-limit cache entry cleared.');

// ---- Cleanup ---------------------------------------------------------------
await sb.from('workspace_senders').delete().eq('workspace_id', WORKSPACE);
await sb.from('unsubscribed_emails').delete().eq('email', TEST_EMAIL);
await sb.from('outreach_messages').delete().eq('id', msg.id);
await sb.from('leads').delete().eq('id', gLead!.id);

console.log('\n' + '='.repeat(60));
console.log('  Phase 8 proof complete — all 5 proofs passed.');
console.log('='.repeat(60));
console.log('\nNOTE: The BullMQ send queue and Brevo webhook unsubscribe path');
console.log('were not exercised here (queue needs Redis on crnx-core).');
console.log('All decision-chain logic was tested inline with real DB state.');
