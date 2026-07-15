import { Worker, type Job } from "bullmq";
import { helius, type HeliusConfig } from "@ceronix/kira-shared";
import { bullConnection, redis } from "../lib/redis.js";
import { supabase } from "../lib/supabase.js";

const DEBOUNCE_KEY = "heliussync:debounce";
const DEBOUNCE_TTL_SECONDS = 30;

const heliusConfig: HeliusConfig = { apiKey: process.env.HELIUS_API_KEY ?? "" };
const webhookUrl = process.env.HELIUS_WEBHOOK_URL ?? "";
const webhookSecret = process.env.HELIUS_WEBHOOK_SECRET ?? "";

async function resolveWebhookId(addresses: string[]): Promise<string | null> {
  const existing = await helius.listWebhooks(heliusConfig);
  const ours = existing.find((w) => w.webhookURL === webhookUrl);
  if (ours) return ours.webhookID;

  if (addresses.length === 0) return null; // nothing to register yet

  const created = await helius.registerWebhook(heliusConfig, addresses, webhookUrl, webhookSecret);
  return created?.webhookID ?? null;
}

async function processHeliusSync(_job: Job): Promise<void> {
  const isFirstInWindow = await redis.set(DEBOUNCE_KEY, "1", "EX", DEBOUNCE_TTL_SECONDS, "NX");
  if (!isFirstInWindow) return; // another sync already ran within the debounce window

  const { data: watched, error } = await supabase
    .from("kira_watched_addresses")
    .select("address")
    .gt("watcher_count", 0);

  if (error) {
    console.error("[kira-workers:helius-sync] watched address query failed:", error.message);
    return;
  }

  const addresses = Array.from(new Set((watched ?? []).map((w) => w.address)));

  const webhookId = await resolveWebhookId(addresses);
  if (!webhookId) {
    console.error("[kira-workers:helius-sync] no webhook to update (registration failed or no addresses yet)");
    return;
  }

  const ok = await helius.updateWebhookAddresses(heliusConfig, webhookId, addresses);
  if (!ok) {
    console.error("[kira-workers:helius-sync] updateWebhookAddresses failed");
    return;
  }

  if (addresses.length > 0) {
    const { error: updateError } = await supabase
      .from("kira_watched_addresses")
      .update({ helius_registered: true })
      .in("address", addresses);

    if (updateError) {
      console.error("[kira-workers:helius-sync] helius_registered flag update failed:", updateError.message);
    }
  }
}

export function startHeliusSyncWorker(): Worker {
  return new Worker("kira-helius-sync", processHeliusSync, {
    connection: bullConnection,
    concurrency: 1,
  });
}
