import WebSocket from "ws";
import { signalScanQueue } from "../lib/queues.js";
import { redis } from "../lib/redis.js";

const WS_URL = "wss://gmgn.ai/ws";
const MAX_BACKOFF_MS = 60_000;
const BASE_BACKOFF_MS = 2_000;
const DEDUPE_TTL_SECONDS = 48 * 60 * 60; // matches signal:seen:{tokenAddress} elsewhere

/**
 * GMGN WebSocket was verified live before writing any of this: `wss://gmgn.ai/ws` rejects the
 * handshake itself with a 403 Forbidden (not a message-level auth error after connecting -- the
 * upgrade request itself is refused). This is consistent with everything else learned about
 * GMGN's real API surface this sprint: gmgn-cli has no stream/ws/watch subcommand at all, and the
 * official CLI reference doc (docs/cli-usage.md) has zero mentions of websocket/wss/stream/
 * subscribe anywhere. There is no documented, working real-time channel for this API key -- the
 * sprint spec's wss://gmgn.ai/ws URL and subscribe_new_liquidity_pool/signal_type message shapes
 * are unverified assumptions that could not be tested past the handshake rejection.
 *
 * Given a 403 at the handshake is an auth/authorization-level rejection, not a transient network
 * issue, reconnecting with backoff cannot fix it -- retrying forever would just be noise. This
 * worker tries once, and if the handshake itself is rejected, logs clearly and disables further
 * reconnection. Any other failure mode (network blip, unexpected close after a real open) does
 * get exponential backoff, in case GMGN's WebSocket becomes reachable in the future without a
 * code change here. It never throws or takes kira-workers down either way.
 *
 * The Helius program-log webhook (kira-helius-sync's /webhooks/helius-programs route, Sprint 5)
 * remains the sole real trigger for kira-signal-scan as a result -- not a "fallback" behind a
 * working primary, since the WebSocket primary never actually works.
 */

let reconnectAttempt = 0;
let permanentlyDisabled = false;

async function enqueueSignalScan(tokenAddress: string, firstSeenAt: number): Promise<void> {
  const dedupeKey = `signal:seen:${tokenAddress}`;
  const isNew = await redis.set(dedupeKey, "1", "EX", DEDUPE_TTL_SECONDS, "NX");
  if (!isNew) return;
  await signalScanQueue.add("scan", { tokenAddress, firstSeenAt }, { removeOnComplete: true, removeOnFail: true });
}

/** UNVERIFIED: never actually observed a real message from this socket (handshake never
 * succeeds), this shape comes only from the sprint spec's description. Kept defensive (any/
 * unknown parsing, no assumptions past a top-level type/signal_type field) so if GMGN's real
 * message shape differs, this fails safe (ignores the message) rather than throwing. */
async function handleMessage(raw: WebSocket.RawData): Promise<void> {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return;
  }

  const type = typeof msg.type === "string" ? msg.type : null;

  if (type === "new_liquidity_pool") {
    const tokenAddress = typeof msg.token_address === "string" ? msg.token_address : null;
    if (!tokenAddress) return;
    try {
      await enqueueSignalScan(tokenAddress, Date.now());
    } catch (err) {
      console.error("[kira-gmgn-ws] failed to enqueue signal scan:", err instanceof Error ? err.message : err);
    }
    return;
  }

  if (typeof msg.signal_type === "number" && msg.signal_type === 12) {
    const tokenAddress = typeof msg.token_address === "string" ? msg.token_address : null;
    if (!tokenAddress) return;
    // Deliberately not writing to kira_alerts here: that table's user_id is NOT NULL, it's a
    // per-user notification record, and a GMGN aggregate cluster-buy signal isn't tied to any
    // one user's roster. kira_smart_money_events (Sprint 6 Part 3) is per-wallet-event and also
    // doesn't fit an aggregate signal with no specific wallet_address. Since this path is
    // unreachable in practice (the handshake itself 403s), routing this to the right table/user
    // fan-out is a real design decision for whenever GMGN's WebSocket actually becomes reachable,
    // not something to guess at with a schema-mismatched insert that would just fail silently.
    console.log(`[kira-gmgn-ws] smart money cluster buy signal for ${tokenAddress} (not persisted, see comment)`);
  }
}

function connect(apiKey: string): void {
  if (permanentlyDisabled) return;

  const ws = new WebSocket(WS_URL, { headers: { Authorization: `Bearer ${apiKey}` } });

  ws.on("open", () => {
    reconnectAttempt = 0;
    console.log("[kira-gmgn-ws] Connected, listening for new LP events");
    // UNVERIFIED message shape, see handleMessage's comment -- never actually confirmed against
    // a real successful connection.
    ws.send(JSON.stringify({ action: "subscribe", channel: "subscribe_new_liquidity_pool", chain: "sol" }));
    ws.send(JSON.stringify({ action: "subscribe", channel: "smart_money_signal", signal_type: 12, chain: "sol" }));
  });

  ws.on("message", (data) => {
    void handleMessage(data);
  });

  ws.on("unexpected-response", (_req, res) => {
    if (res.statusCode === 403) {
      permanentlyDisabled = true;
      console.error(
        `[kira-gmgn-ws] WebSocket handshake rejected with 403 Forbidden -- this is an auth/` +
          `authorization-level rejection, not a transient failure, so reconnection is disabled. ` +
          `GMGN's real-time channel is not available for this API key or does not exist at ` +
          `${WS_URL}. Helius's program-log webhook remains the only working signal-scan trigger.`,
      );
      return;
    }
    console.error(`[kira-gmgn-ws] unexpected response, status ${res.statusCode}, will retry with backoff`);
    scheduleReconnect(apiKey);
  });

  ws.on("error", (err) => {
    console.error("[kira-gmgn-ws] connection error:", err.message);
  });

  ws.on("close", (code) => {
    if (permanentlyDisabled) return;
    console.error(`[kira-gmgn-ws] connection closed (code ${code}), will retry with backoff`);
    scheduleReconnect(apiKey);
  });
}

function scheduleReconnect(apiKey: string): void {
  if (permanentlyDisabled) return;
  const delay = Math.min(BASE_BACKOFF_MS * 2 ** reconnectAttempt, MAX_BACKOFF_MS);
  reconnectAttempt++;
  setTimeout(() => connect(apiKey), delay);
}

/** Not a BullMQ Worker (no queue backs this) -- same "long-lived connection started once at
 * kira-workers boot" pattern as kolIngestWorker.startKolIngest(), called directly from index.ts
 * rather than pushed onto the workers[] array that gets .close()'d together, since there's no
 * BullMQ Worker instance to close, just a raw WebSocket. */
export function startGmgnWebSocket(): void {
  const apiKey = process.env.GMGN_API_KEY;
  if (!apiKey) {
    console.error("[kira-gmgn-ws] missing GMGN_API_KEY, GMGN WebSocket disabled");
    return;
  }
  connect(apiKey);
}
