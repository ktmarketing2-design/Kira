import { Worker, type Job } from "bullmq";
import { bullConnection, redis } from "../lib/redis.js";
import { supabase } from "../lib/supabase.js";
import { telegramApi } from "../lib/telegram.js";
import { escapeMarkdownV2, truncateAddress } from "../lib/format.js";
import { ddQueue, ddQueueEvents } from "../lib/queues.js";
import type { DdCard } from "./ddWorker.js";

interface AlertDispatchJobData {
  alertId: string;
}

interface AlertRow {
  id: string;
  user_id: string;
  type: string;
  token_address: string;
  token_symbol: string | null;
  wallet_addresses: string[];
  wallet_count: number;
  total_usd: number | null;
  window_minutes: number;
  first_buyer_address: string | null;
}

async function loadDdCard(tokenAddress: string): Promise<DdCard | null> {
  const cached = await redis.get(`ddcard:${tokenAddress}`);
  if (cached) return JSON.parse(cached) as DdCard;

  try {
    const job = await ddQueue.add(
      "dd",
      { tokenAddress },
      { removeOnComplete: true, removeOnFail: true },
    );
    return (await job.waitUntilFinished(ddQueueEvents, 15_000)) as DdCard;
  } catch (err) {
    console.error("[kira-workers:alert-dispatch] dd card fetch failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

function formatWalletLine(address: string, usd: number | null, label?: string | null): string {
  const name = label ? escapeMarkdownV2(label) : escapeMarkdownV2(truncateAddress(address));
  const amount = usd != null ? `$${usd.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "$?";
  return `${name} \\— ${escapeMarkdownV2(amount)}`;
}

async function buildMessage(alert: AlertRow, ddCard: DdCard | null): Promise<string> {
  const { data: walletRows } = await supabase
    .from("kira_roster_wallets")
    .select("address, label")
    .in("address", alert.wallet_addresses);
  const labelByAddress = new Map((walletRows ?? []).map((w) => [w.address, w.label]));

  const symbol = alert.token_symbol ?? "UNKNOWN";
  const tokenLine = `*${escapeMarkdownV2(symbol)}* \`${escapeMarkdownV2(truncateAddress(alert.token_address))}\``;

  const walletLines = alert.wallet_addresses
    .slice(0, 5)
    .map((addr) => formatWalletLine(addr, null, labelByAddress.get(addr)))
    .join("\n");

  const firstMoverLabel = alert.first_buyer_address
    ? labelByAddress.get(alert.first_buyer_address) ?? truncateAddress(alert.first_buyer_address)
    : "unknown";

  const rugScore = ddCard?.safety.rugScore ?? "?";
  const volumeScore = ddCard?.volume?.score ?? "?";
  const volumeVerdict = ddCard?.volume?.verdict ?? "unknown";

  return [
    "🚨 *Cluster Alert*",
    "",
    tokenLine,
    "Chain: Solana",
    "",
    `👥 *${alert.wallet_count} of your tracked wallets buying*`,
    walletLines,
    `⚡ First mover: ${escapeMarkdownV2(firstMoverLabel)}`,
    "",
    `💰 Total cluster size: ${escapeMarkdownV2(`$${(alert.total_usd ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`)}`,
    "",
    `🛡 Rug Score: ${escapeMarkdownV2(`${rugScore}/100`)}`,
    `📊 Volume Score: ${escapeMarkdownV2(`${volumeScore}/100 (${volumeVerdict})`)}`,
  ].join("\n");
}

async function pushRealtimeAlert(userId: string, alert: AlertRow): Promise<void> {
  const channel = supabase.channel(`alerts:${userId}`);
  await new Promise<void>((resolve) => {
    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.send({ type: "broadcast", event: "new_alert", payload: alert });
        await supabase.removeChannel(channel);
        resolve();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        resolve();
      }
    });
  });
}

async function processAlertDispatch(job: Job<AlertDispatchJobData>): Promise<void> {
  const { alertId } = job.data;

  const { data: alert, error } = await supabase
    .from("kira_alerts")
    .select("*")
    .eq("id", alertId)
    .single<AlertRow>();

  if (error || !alert) {
    console.error("[kira-workers:alert-dispatch] alert not found:", error?.message ?? alertId);
    return;
  }

  const ddCard = await loadDdCard(alert.token_address);
  const message = await buildMessage(alert, ddCard);

  const { data: profile } = await supabase
    .from("kira_profiles")
    .select("telegram_user_id")
    .eq("id", alert.user_id)
    .maybeSingle();

  let deliveredTelegram = false;
  if (profile?.telegram_user_id) {
    try {
      await telegramApi.sendMessage(profile.telegram_user_id, message, {
        parse_mode: "MarkdownV2",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "Full DD", callback_data: `dd:${alert.token_address}` },
              { text: "Mute Token 24h", callback_data: `mute:${alert.token_address}` },
            ],
          ],
        },
      });
      deliveredTelegram = true;
    } catch (err) {
      console.error(
        "[kira-workers:alert-dispatch] telegram send failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  await pushRealtimeAlert(alert.user_id, alert);

  const { error: updateError } = await supabase
    .from("kira_alerts")
    .update({ delivered_telegram: deliveredTelegram, delivered_web: true })
    .eq("id", alertId);

  if (updateError) {
    console.error("[kira-workers:alert-dispatch] delivery flag update failed:", updateError.message);
  }
}

export function startAlertDispatchWorker(): Worker<AlertDispatchJobData, void> {
  return new Worker<AlertDispatchJobData, void>("kira-alert-dispatch", processAlertDispatch, {
    connection: bullConnection,
    concurrency: 10,
  });
}
