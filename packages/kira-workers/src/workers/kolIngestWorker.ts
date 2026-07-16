import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage, type NewMessageEvent } from "telegram/events/index.js";
import type { Entity } from "telegram/define.js";
import { jupiter } from "@ceronix/kira-shared";
import { redis } from "../lib/redis.js";
import { supabase } from "../lib/supabase.js";
import { reserveGeminiBudget, generateText } from "../lib/gemini.js";
import { kolPriceCheckQueue } from "../lib/queues.js";

const CLASSIFY_MODEL = "gemini-flash-lite-latest";
const CLASSIFY_ESTIMATED_TOKENS = 200;
const BACKFILL_DAYS = 30;
const BACKFILL_DONE_TTL_SECONDS = 400 * 24 * 60 * 60; // long-lived, backfill is meant to run once ever

// 32-44 chars, base58 alphabet (no 0/O/I/l), same pattern used by the /kol regex pre-filter spec.
const SOLANA_ADDRESS_RE = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

const FORWARD_CHECKS: Array<{ checkType: "1h" | "4h" | "24h" | "7d"; delayMs: number }> = [
  { checkType: "1h", delayMs: 60 * 60 * 1000 },
  { checkType: "4h", delayMs: 4 * 60 * 60 * 1000 },
  { checkType: "24h", delayMs: 24 * 60 * 60 * 1000 },
  { checkType: "7d", delayMs: 7 * 24 * 60 * 60 * 1000 },
];

interface KolSourceRow {
  id: string;
  channel_identifier: string;
  display_name: string | null;
}

async function loadActiveSources(): Promise<KolSourceRow[]> {
  const { data, error } = await supabase
    .from("kira_kol_sources")
    .select("id, channel_identifier, display_name")
    .eq("active", true);
  if (error) {
    console.error("[kira-workers:kol-ingest] source load failed:", error.message);
    return [];
  }
  return data ?? [];
}

function extractCandidateAddress(text: string): string | null {
  const matches = text.match(SOLANA_ADDRESS_RE);
  return matches?.[0] ?? null;
}

/** Returns null specifically when the daily Gemini budget is exhausted (distinct from a
 * confident "no"), so callers — backfill in particular — can tell "not a call" apart from
 * "couldn't check, budget's out" and react differently (skip vs. stop and retry later). */
async function classifyIsCall(text: string): Promise<boolean | null> {
  const budgetOk = await reserveGeminiBudget("kol-classify", CLASSIFY_ESTIMATED_TOKENS);
  if (!budgetOk) return null;

  const prompt =
    `Message: "${text.slice(0, 800)}"\n\n` +
    `Is this message a token call or recommendation (someone telling their audience to buy, ape, ` +
    `or watch a specific token)? Reply with exactly one word: Yes or No.`;
  const result = await generateText(prompt, CLASSIFY_MODEL);
  return result?.trim().toLowerCase().startsWith("yes") ?? false;
}

async function scheduleForwardChecks(callId: string, tokenAddress: string): Promise<void> {
  for (const { checkType, delayMs } of FORWARD_CHECKS) {
    await kolPriceCheckQueue.add(
      "check",
      { callId, tokenAddress, checkType },
      { delay: delayMs, removeOnComplete: true, removeOnFail: true },
    );
  }
}

interface ProcessMessageParams {
  sourceId: string | null;
  sourceUserId: string | null;
  messageId: string;
  text: string;
  calledAt: Date;
}

/** Returns "budget_exhausted" to let backfill distinguish that from a normal skip. */
async function processMessageText(params: ProcessMessageParams): Promise<"recorded" | "skipped" | "budget_exhausted"> {
  const candidate = extractCandidateAddress(params.text);
  if (!candidate) return "skipped";

  const isCall = await classifyIsCall(params.text);
  if (isCall === null) return "budget_exhausted";
  if (!isCall) return "skipped";

  const priceAtCall = await jupiter.getPrice(candidate);

  const { data, error } = await supabase
    .from("kira_kol_calls")
    .insert({
      source_id: params.sourceId,
      source_user_id: params.sourceUserId,
      message_id: params.messageId,
      token_address: candidate,
      called_at: params.calledAt.toISOString(),
      price_at_call: priceAtCall,
      raw_text: params.text.slice(0, 500),
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return "skipped"; // already recorded, dedupe on (source_id, message_id)
    console.error("[kira-workers:kol-ingest] call insert failed:", error.message);
    return "skipped";
  }

  await scheduleForwardChecks(data.id, candidate);
  return "recorded";
}

/** One-time per source, guarded by a Redis flag. If the Gemini budget runs out partway through,
 * the flag is deliberately NOT set, so the next kira-workers restart resumes the scan — messages
 * already recorded are skipped again via the (source_id, message_id) unique constraint, so this
 * is safe to re-run rather than needing an explicit resumable cursor. This is a simplification of
 * the spec's "queue remaining messages for next day": it achieves the same outcome (backfill
 * eventually completes without exceeding the daily budget) via retry-on-restart instead of an
 * explicit per-day scheduler. */
async function runBackfillOnce(client: TelegramClient, source: KolSourceRow, entity: Entity): Promise<void> {
  const flagKey = `kolbackfill:done:${source.id}`;
  const alreadyDone = await redis.get(flagKey);
  if (alreadyDone) return;

  console.log(`[kira-workers:kol-ingest] starting 30d backfill for ${source.channel_identifier}`);
  const cutoffSeconds = Date.now() / 1000 - BACKFILL_DAYS * 24 * 60 * 60;
  let scanned = 0;
  let recorded = 0;
  let stoppedForBudget = false;

  try {
    for await (const message of client.iterMessages(entity, { limit: 500 })) {
      if (!message.date || message.date < cutoffSeconds) break; // newest-first, stop past the window
      if (!message.text) continue;

      const result = await processMessageText({
        sourceId: source.id,
        sourceUserId: null,
        messageId: String(message.id),
        text: message.text,
        calledAt: new Date(message.date * 1000),
      });
      scanned++;
      if (result === "recorded") recorded++;
      if (result === "budget_exhausted") {
        stoppedForBudget = true;
        break;
      }
    }

    if (!stoppedForBudget) {
      await redis.set(flagKey, "1", "EX", BACKFILL_DONE_TTL_SECONDS);
    }
    console.log(
      `[kira-workers:kol-ingest] backfill ${stoppedForBudget ? "paused (budget exhausted, retries on next restart)" : "complete"} ` +
        `for ${source.channel_identifier}: scanned ${scanned}, recorded ${recorded}`,
    );
  } catch (err) {
    console.error(
      `[kira-workers:kol-ingest] backfill failed for ${source.channel_identifier}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

export async function startKolIngest(): Promise<void> {
  const apiId = Number(process.env.TELEGRAM_MTPROTO_API_ID);
  const apiHash = process.env.TELEGRAM_MTPROTO_API_HASH ?? "";
  const sessionString = process.env.TELEGRAM_MTPROTO_SESSION ?? "";

  if (!apiId || !apiHash || !sessionString) {
    console.error("[kira-workers:kol-ingest] missing TELEGRAM_MTPROTO_* env vars, KOL ingestion disabled");
    return;
  }

  const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
    connectionRetries: 5,
  });

  try {
    await client.connect();
  } catch (err) {
    console.error(
      "[kira-workers:kol-ingest] Telegram connection failed:",
      err instanceof Error ? err.message : err,
    );
    return;
  }

  const sources = await loadActiveSources();
  if (sources.length === 0) {
    console.log("[kira-workers:kol-ingest] no active KOL sources configured, not listening");
    return;
  }

  // Resolve each channel to a concrete entity up front rather than filtering on channel_identifier
  // strings at message time, and log per-channel failures loudly instead of silently listening to
  // fewer channels than expected.
  const sourceIdByEntityId = new Map<string, string>();
  const entityBySourceId = new Map<string, Entity>();
  for (const source of sources) {
    try {
      const entity = await client.getEntity(source.channel_identifier);
      entityBySourceId.set(source.id, entity);
      sourceIdByEntityId.set(String((entity as { id?: unknown }).id), source.id);
    } catch (err) {
      console.error(
        `[kira-workers:kol-ingest] failed to resolve channel ${source.channel_identifier}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  client.addEventHandler(async (event: NewMessageEvent) => {
    const message = event.message;
    if (!message?.text) return;

    const chatId = String(message.chatId ?? message.peerId);
    const sourceId = sourceIdByEntityId.get(chatId);
    if (!sourceId) return; // message from a channel we resolved but are not tracking (or a DM)

    try {
      await processMessageText({
        sourceId,
        sourceUserId: null,
        messageId: String(message.id),
        text: message.text,
        calledAt: new Date(message.date * 1000),
      });
    } catch (err) {
      console.error(
        "[kira-workers:kol-ingest] message processing failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }, new NewMessage({}));

  console.log(`[kira-workers:kol-ingest] Connected to Telegram, listening on ${entityBySourceId.size} channels`);

  for (const source of sources) {
    const entity = entityBySourceId.get(source.id);
    if (!entity) continue;
    void runBackfillOnce(client, source, entity);
  }
}
