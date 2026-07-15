// =============================================================================
// Production verification for opt-in scheduling
// Proofs:
//   1. PATCH /api/sources/:id/schedule enables a real BullMQ scheduler
//   2. Scheduler ID visible in Redis (via getJobSchedulers)
//   3. Scheduled job fires autonomously, source_runs row created, last_auto_run_at set
//   4. PATCH with autoScheduleEnabled:false removes the scheduler from Redis
//   5. New source defaults to auto_schedule_enabled=false
//   6. Invalid cron and sub-hourly cron both rejected with 400
//
// NOTE ON PROOF 3 INTERVAL: this script temporarily registers a 2-minute
// cron via registerSourceSchedule() directly -- bypassing the route's
// minimum-interval validation deliberately, for proof purposes only.
// The scheduler is removed as part of this script's execution.
// "*/2 * * * *" is used here and nowhere else in production code.
// =============================================================================

import { createClient } from '@supabase/supabase-js';
import { registerSourceSchedule, removeSourceSchedule, listActiveSchedulers, SCHEDULER_ID } from '../apps/worker/src/scheduler.js';

const url  = process.env.SUPABASE_URL!;
const key  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const base = process.env.VANTAGE_API_BASE ?? 'https://vantage.ceronix.ai';

const sb = createClient(url, key, { auth: { persistSession: false } });

function pass(label: string, detail?: string) {
  console.log(`  [PASS] ${label}${detail ? ` — ${detail}` : ''}`);
}
function fail(label: string, detail?: string) {
  console.log(`  [FAIL] ${label}${detail ? ` — ${detail}` : ''}`);
}
function check(label: string, condition: boolean, detail?: string) {
  condition ? pass(label, detail) : fail(label, detail);
}

async function run() {
  // --- Setup: ephemeral user + workspace ---
  const email    = `scheduling-proof-${Date.now()}@example.com`;
  const password = 'TestPassword123!';

  const { data: { user }, error: createErr } = await sb.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (createErr || !user) throw new Error(`User create: ${createErr?.message}`);
  await sb.from('profiles').insert({ id: user.id, email: user.email!, full_name: 'Scheduling Proof User' });

  const { data: { session } } = await createClient(url, key, { auth: { persistSession: false } })
    .auth.signInWithPassword({ email, password });
  if (!session) throw new Error('Sign in failed');
  const jwt = session.access_token;

  const { data: ws } = await sb.from('workspaces')
    .insert({ name: 'Scheduling Proof WS', slug: `sched-proof-${Date.now()}` })
    .select('id').single();
  const workspaceId = ws!.id;
  await sb.from('workspace_members').insert({ workspace_id: workspaceId, user_id: user.id, role: 'owner' });

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${jwt}`,
    'x-workspace-id': workspaceId,
    'Content-Type': 'application/json',
  };

  // Seed a news_rss source (cheapest adapter, no paid quota)
  const { data: sourceRow } = await sb.from('signal_sources').insert({
    workspace_id: workspaceId,
    kind: 'web_search',
    adapter: 'news_rss',
    config: { query: 'B2B SaaS funding', signalType: 'funding' },
    is_enabled: true,
    // auto_schedule_enabled omitted: should default to false
  }).select('id, auto_schedule_enabled, schedule_cron, last_auto_run_at').single();

  const sourceId = sourceRow!.id;

  try {
    // -------------------------------------------------------------------------
    console.log('\n--- Proof 5: new source defaults to auto_schedule_enabled=false ---');
    check(
      'auto_schedule_enabled is false on creation',
      sourceRow!.auto_schedule_enabled === false,
      `auto_schedule_enabled = ${sourceRow!.auto_schedule_enabled}`,
    );
    check('schedule_cron is null on creation', sourceRow!.schedule_cron === null);
    check('last_auto_run_at is null on creation', sourceRow!.last_auto_run_at === null);

    // -------------------------------------------------------------------------
    console.log('\n--- Proof 6: cron validation rejects invalid and sub-hourly ---');

    const badCronRes = await fetch(`${base}/api/sources/${sourceId}/schedule`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ autoScheduleEnabled: true, cron: 'not a cron' }),
    });
    check('Invalid cron returns 400', badCronRes.status === 400, `status=${badCronRes.status}`);
    const badCronBody = await badCronRes.json() as { error: string };
    check('Error message mentions "Invalid cron"', badCronBody.error.includes('Invalid cron'), badCronBody.error);

    const subHourlyRes = await fetch(`${base}/api/sources/${sourceId}/schedule`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ autoScheduleEnabled: true, cron: '*/5 * * * *' }),
    });
    check('Sub-hourly cron (*/5) returns 400', subHourlyRes.status === 400, `status=${subHourlyRes.status}`);
    const subHourlyBody = await subHourlyRes.json() as { error: string };
    check('Error message mentions minimum interval', subHourlyBody.error.includes('Minimum'), subHourlyBody.error);

    // -------------------------------------------------------------------------
    console.log('\n--- Proof 1+2: enable schedule via PATCH, confirm BullMQ scheduler in Redis ---');

    const enableRes = await fetch(`${base}/api/sources/${sourceId}/schedule`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ autoScheduleEnabled: true, cron: '0 9 * * *' }),
    });
    check('Enable returns 200', enableRes.status === 200, `status=${enableRes.status}`);
    const enableBody = await enableRes.json() as { autoScheduleEnabled: boolean; scheduleCron: string };
    check('Response confirms autoScheduleEnabled=true', enableBody.autoScheduleEnabled === true);
    check('Response echoes cron', enableBody.scheduleCron === '0 9 * * *', enableBody.scheduleCron);

    // Verify DB was updated
    const { data: afterEnable } = await sb.from('signal_sources')
      .select('auto_schedule_enabled, schedule_cron')
      .eq('id', sourceId).single();
    check('DB: auto_schedule_enabled=true', afterEnable!.auto_schedule_enabled === true);
    check('DB: schedule_cron set', afterEnable!.schedule_cron === '0 9 * * *', afterEnable!.schedule_cron);

    // Verify BullMQ scheduler registered in Redis
    const schedulers = await listActiveSchedulers();
    const expectedId = SCHEDULER_ID(sourceId);
    check(
      'BullMQ scheduler registered in Redis',
      schedulers.includes(expectedId),
      `looking for "${expectedId}", found: [${schedulers.join(', ')}]`,
    );

    // -------------------------------------------------------------------------
    console.log('\n--- Proof 3: autonomous fire (2-min cron, bypasses route validation deliberately) ---');
    console.log('  NOTE: using */2 * * * * directly via registerSourceSchedule(), not the PATCH route.');
    console.log('  This bypass is intentional for proof only. Scheduler removed before script exits.');

    // Replace the daily cron with a 2-minute one for the fire test
    await registerSourceSchedule(sourceId, workspaceId, '*/2 * * * *');
    console.log(`  Scheduler updated to */2 * * * * for ${sourceId}. Waiting up to 3 minutes for autonomous fire...`);

    const fireDeadline = Date.now() + 3 * 60 * 1000;
    let fired = false;
    while (Date.now() < fireDeadline) {
      await new Promise(r => setTimeout(r, 15_000));

      // Check for a source_runs row created without a manual trigger
      const { data: runs } = await sb.from('source_runs')
        .select('id, started_at, status')
        .eq('source_id', sourceId)
        .order('started_at', { ascending: false })
        .limit(1);

      if (runs && runs.length > 0) {
        console.log(`  Autonomous run detected: run id=${runs[0].id}, status=${runs[0].status}, started=${runs[0].started_at}`);
        fired = true;
        break;
      }
      console.log(`  Still waiting... (${Math.round((fireDeadline - Date.now()) / 1000)}s remaining)`);
    }

    check('Source ran autonomously (source_runs row created without manual trigger)', fired);

    if (fired) {
      const { data: sourceAfterFire } = await sb.from('signal_sources')
        .select('last_auto_run_at')
        .eq('id', sourceId).single();
      check(
        'last_auto_run_at updated after autonomous run',
        sourceAfterFire!.last_auto_run_at !== null,
        `last_auto_run_at = ${sourceAfterFire!.last_auto_run_at}`,
      );
    }

    // -------------------------------------------------------------------------
    console.log('\n--- Proof 4: disable removes BullMQ scheduler from Redis ---');

    const disableRes = await fetch(`${base}/api/sources/${sourceId}/schedule`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ autoScheduleEnabled: false }),
    });
    check('Disable returns 200', disableRes.status === 200, `status=${disableRes.status}`);

    // Verify DB updated
    const { data: afterDisable } = await sb.from('signal_sources')
      .select('auto_schedule_enabled, schedule_cron')
      .eq('id', sourceId).single();
    check('DB: auto_schedule_enabled=false after disable', afterDisable!.auto_schedule_enabled === false);
    check('DB: schedule_cron=null after disable', afterDisable!.schedule_cron === null);

    // Verify BullMQ scheduler is GONE from Redis
    const schedulersAfter = await listActiveSchedulers();
    const stillPresent = schedulersAfter.includes(SCHEDULER_ID(sourceId));
    check(
      'BullMQ scheduler removed from Redis (not just DB flag)',
      !stillPresent,
      stillPresent
        ? `STILL PRESENT: "${SCHEDULER_ID(sourceId)}" — disable failed`
        : `"${SCHEDULER_ID(sourceId)}" is gone from Redis`,
    );

  } finally {
    // Safety net: always attempt removal in case an earlier step left it registered
    await removeSourceSchedule(sourceId).catch(() => {});

    // Cleanup ephemeral rows
    await sb.from('source_runs').delete().eq('source_id', sourceId);
    await sb.from('signal_sources').delete().eq('id', sourceId);
    await sb.from('workspace_members').delete().eq('workspace_id', workspaceId);
    await sb.from('workspaces').delete().eq('id', workspaceId);
    await sb.auth.admin.deleteUser(user.id);
    console.log('\n[CLEANUP] Ephemeral user, workspace, source, and runs removed.');
    console.log('[CLEANUP] 2-minute scheduler removed (or was already removed by disable proof).');
  }
}

run().catch(e => { console.error(e); process.exit(1); });
