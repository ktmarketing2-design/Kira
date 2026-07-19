import { Router } from "express";
import { z } from "zod";
import { redis } from "../lib/redis.js";
import { supabase } from "../lib/supabase.js";
import { ddQueue, ddQueueEvents } from "../lib/queue.js";
import { requireAskQuota } from "../middleware/tier.js";
import { gemini, twitter } from "@ceronix/kira-shared";

const router = Router();

const DD_JOB_TIMEOUT_MS = 30_000;
const ROSTER_ACTIVITY_LOOKBACK_DAYS = 30;
const SMART_MONEY_LOOKBACK_DAYS = 7;

interface CachedDdCard {
  symbol: string | null;
  name: string | null;
  market: { fdvUsd: number | null; liquidityUsd: number | null };
  safety: { rugScore: number };
  volume: { score: number } | null;
  deepIntel: { smartDegenCount: number | null; renownedWallets: number | null; top10HolderPct: number | null } | null;
}

async function getDdCard(tokenAddress: string, requestedBy: string): Promise<CachedDdCard | null> {
  const cached = await redis.get(`ddcard:${tokenAddress}`);
  if (cached) return JSON.parse(cached);

  try {
    const job = await ddQueue.add("dd", { tokenAddress, requestedBy }, { removeOnComplete: true, removeOnFail: true });
    return (await job.waitUntilFinished(ddQueueEvents, DD_JOB_TIMEOUT_MS)) as CachedDdCard;
  } catch {
    return null;
  }
}

interface KolCallContext {
  channel: string;
  calledAt: string;
  priceAtCall: number | null;
}

async function getKolCallsForToken(tokenAddress: string): Promise<KolCallContext[]> {
  const { data: calls } = await supabase
    .from("kira_kol_calls")
    .select("source_id, source_type, called_at, price_at_call")
    .eq("token_address", tokenAddress)
    .order("called_at", { ascending: false })
    .limit(10);

  if (!calls || calls.length === 0) return [];

  const sourceIds = [...new Set(calls.map((c) => c.source_id).filter((id): id is string => id != null))];
  const { data: sources } = sourceIds.length
    ? await supabase.from("kira_kol_sources").select("id, display_name, channel_identifier").in("id", sourceIds)
    : { data: [] };
  const nameById = new Map((sources ?? []).map((s) => [s.id, s.display_name ?? s.channel_identifier]));

  return calls.map((c) => ({
    channel: c.source_type === "gmgn_kol" ? "GMGN KOL" : (c.source_id ? nameById.get(c.source_id) ?? "Unknown" : "Unknown"),
    calledAt: c.called_at,
    priceAtCall: c.price_at_call,
  }));
}

interface SmartMoneyEventRow {
  side: string;
  usd_value: number | null;
}

async function getSmartMoneyForToken(tokenAddress: string): Promise<SmartMoneyEventRow[]> {
  const since = new Date(Date.now() - SMART_MONEY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("kira_smart_money_events")
    .select("side, usd_value")
    .eq("token_address", tokenAddress)
    .gte("block_time", since);
  return data ?? [];
}

interface RosterActivityRow {
  wallet_address: string;
  side: string;
  usd_value: number | null;
  block_time: string;
}

async function getRosterActivityForToken(tokenAddress: string, userId: string): Promise<RosterActivityRow[]> {
  const { data: rosterRows } = await supabase.from("kira_roster_wallets").select("address").eq("user_id", userId);
  const addresses = (rosterRows ?? []).map((r) => r.address);
  if (addresses.length === 0) return [];

  const since = new Date(Date.now() - ROSTER_ACTIVITY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("kira_wallet_events")
    .select("wallet_address, side, usd_value, block_time")
    .eq("token_address", tokenAddress)
    .in("wallet_address", addresses)
    .gte("block_time", since)
    .order("block_time", { ascending: false })
    .limit(20);
  return data ?? [];
}

const askSchema = z.object({
  tokenAddress: z.string().min(32).max(64),
  question: z.string().min(1).max(500),
});

const TWITTER_INTENT_RE = /twitter|\bx\b|tweet|people (are )?saying|social (media )?(sentiment|buzz|chatter)/i;

/** Only called when the question actually looks Twitter-related -- unlike kolCalls/smartMoney/
 * rosterActivity (all free, already-fetched-from-our-own-DB data), this burns a real request
 * against Twitter's 1-req/5s free-tier limit, so it is not worth fetching on every single /ask
 * call regardless of relevance. */
async function getTwitterMentions(tokenSymbol: string | null, tokenAddress: string): Promise<
  Array<{ text: string; author: string | null; createdAt: string; likeCount: number }>
> {
  const query = tokenSymbol ? ("$" + tokenSymbol + " OR " + tokenAddress) : tokenAddress;
  const tweets = await twitter.searchTweets(query, 5);
  return tweets.map((t) => ({
    text: t.text.slice(0, 280),
    author: t.authorUsername,
    createdAt: t.createdAt,
    likeCount: t.likeCount,
  }));
}

const SYSTEM_PROMPT = `You are Kira, an on-chain intelligence assistant for Solana traders.
Answer the user's question about the token using only the data provided.
Be concise (under 500 characters). Use numbers and facts. If data is not available, say so honestly.`;

router.post("/", requireAskQuota, async (req, res) => {
  const parsed = askSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }
  const { tokenAddress, question } = parsed.data;
  const userId = req.user!.id;

  const wantsTwitter = TWITTER_INTENT_RE.test(question);

  const [ddCard, kolCalls, smartMoney, rosterActivity] = await Promise.all([
    getDdCard(tokenAddress, userId),
    getKolCallsForToken(tokenAddress),
    getSmartMoneyForToken(tokenAddress),
    getRosterActivityForToken(tokenAddress, userId),
  ]);

  const twitterMentions = wantsTwitter ? await getTwitterMentions(ddCard?.symbol ?? null, tokenAddress) : null;

  const contextData = {
    token: {
      address: tokenAddress,
      symbol: ddCard?.symbol ?? null,
      name: ddCard?.name ?? null,
      rugScore: ddCard?.safety.rugScore ?? null,
      volumeScore: ddCard?.volume?.score ?? null,
      smartDegenCount: ddCard?.deepIntel?.smartDegenCount ?? null,
      renownedCount: ddCard?.deepIntel?.renownedWallets ?? null,
      marketCap: ddCard?.market.fdvUsd ?? null,
      liquidity: ddCard?.market.liquidityUsd ?? null,
      top10HolderPct: ddCard?.deepIntel?.top10HolderPct ?? null,
    },
    kolCalls,
    smartMoney: {
      recentBuys: smartMoney.filter((e) => e.side === "buy").length,
      recentSells: smartMoney.filter((e) => e.side === "sell").length,
      netFlowUsd: smartMoney.reduce((sum, e) => sum + (e.side === "buy" ? (e.usd_value ?? 0) : -(e.usd_value ?? 0)), 0),
    },
    rosterActivity: rosterActivity.map((e) => ({
      wallet: e.wallet_address,
      side: e.side,
      usdValue: e.usd_value,
      timestamp: e.block_time,
    })),
    ...(twitterMentions ? { recentTwitterMentions: twitterMentions } : {}),
  };

  const answer = await gemini.generateText(
    `Context: ${JSON.stringify(contextData)}\n\nQuestion: ${question}`,
    SYSTEM_PROMPT,
  );

  if (!answer) {
    res.status(502).json({ error: "Couldn't generate an answer right now" });
    return;
  }

  res.json({ answer, tokenAddress });
});

export default router;
