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
  filter_id: string | null;
  token_address: string;
  token_symbol: string | null;
  wallet_addresses: string[];
  wallet_count: number;
  total_usd: number | null;
  window_minutes: number;
  first_buyer_address: string | null;
  dd_score: number | null;
  volume_score: number | null;
  created_at: string;
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

async function buildClusterMessage(alert: AlertRow, ddCard: DdCard | null): Promise<string> {
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

function formatAge(alert: AlertRow): string {
  // No dedicated "token age" column, the interval between alert creation and now is an accurate
  // enough proxy since Signal Filter alerts fire within minutes of the token itself appearing.
  const ms = Date.now() - new Date(alert.created_at).getTime();
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  return `${Math.round(minutes / 60)} hour${Math.round(minutes / 60) === 1 ? "" : "s"}`;
}

async function buildSignalFilterMessage(alert: AlertRow, ddCard: DdCard | null): Promise<string> {
  const { data: filter } = alert.filter_id
    ? await supabase.from("kira_signal_filters").select("name").eq("id", alert.filter_id).maybeSingle()
    : { data: null };

  const { data: walletRows } = alert.wallet_addresses.length
    ? await supabase.from("kira_roster_wallets").select("address, label").in("address", alert.wallet_addresses)
    : { data: [] };
  const labelByAddress = new Map((walletRows ?? []).map((w) => [w.address, w.label]));

  const symbol = alert.token_symbol ?? ddCard?.symbol ?? "UNKNOWN";
  const launchpadLabel = ddCard?.launchpad ?? "unknown";
  const graduationLabel = ddCard?.graduated === true ? "graduated" : "pre-graduation";

  const lines = [
    `🎯 *Signal Filter Match: "${escapeMarkdownV2(filter?.name ?? "Unnamed filter")}"*`,
    "",
    `🪙 *$${escapeMarkdownV2(symbol)}* \`${escapeMarkdownV2(truncateAddress(alert.token_address))}\``,
    `🚀 Launchpad: ${escapeMarkdownV2(`${launchpadLabel} (${graduationLabel})`)}`,
    `⏱ Age: ${escapeMarkdownV2(formatAge(alert))}`,
    "",
    `🛡 Rug Score: ${escapeMarkdownV2(`${alert.dd_score ?? ddCard?.safety.rugScore ?? "?"}/100`)}`,
    `📊 Volume Score: ${escapeMarkdownV2(`${alert.volume_score ?? ddCard?.volume?.score ?? "?"}/100 (${ddCard?.volume?.verdict ?? "unknown"})`)}`,
  ];

  if (ddCard?.market.liquidityUsd != null) {
    lines.push(escapeMarkdownV2(`💰 Liquidity: $${Math.round(ddCard.market.liquidityUsd).toLocaleString("en-US")}`));
  }
  if (ddCard?.market.fdvUsd != null) {
    lines.push(escapeMarkdownV2(`📉 FDV: $${Math.round(ddCard.market.fdvUsd).toLocaleString("en-US")}`));
  }

  if (ddCard?.socialSignals) {
    lines.push(
      "",
      escapeMarkdownV2(
        `🌐 ${ddCard.socialSignals.kolMentions} tracked channels • ${ddCard.socialSignals.trending ? "Trending" : "Not trending"}`,
      ),
    );
  }

  if (alert.wallet_addresses.length > 0) {
    lines.push("", `👛 *${alert.wallet_count} of your tracked wallets buying*`);
    for (const addr of alert.wallet_addresses.slice(0, 5)) {
      lines.push(formatWalletLine(addr, null, labelByAddress.get(addr)));
    }
  }

  return lines.join("\n");
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

function inlineKeyboardFor(alert: AlertRow): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
  // Same [Full DD] [Mute Token 24h] pair for both alert types today, kept as its own function
  // since cluster and signal-filter alerts are likely to diverge here later (e.g. Add to Watchlist).
  return {
    inline_keyboard: [
      [
        { text: "Full DD", callback_data: `dd:${alert.token_address}` },
        { text: "Mute Token 24h", callback_data: `mute:${alert.token_address}` },
      ],
    ],
  };
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
  const message =
    alert.type === "signal_filter_match"
      ? await buildSignalFilterMessage(alert, ddCard)
      : await buildClusterMessage(alert, ddCard);

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
        reply_markup: inlineKeyboardFor(alert),
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
