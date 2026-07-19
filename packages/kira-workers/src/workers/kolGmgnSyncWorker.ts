import { Worker } from "bullmq";
import { gmgnApi, jupiter, twitter } from "@ceronix/kira-shared";
import { bullConnection, redis } from "../lib/redis.js";
import { supabase } from "../lib/supabase.js";

const DEDUPE_TTL_SECONDS = 24 * 60 * 60;

// 32-44 chars, base58 alphabet (no 0/O/I/l), same pattern kolIngestWorker.ts uses for Telegram.
const SOLANA_ADDRESS_RE = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

// Twitter free-tier is 1 req/5s (verified live). Processing one account at a time with an
// explicit wait, rather than relying on the client's own limiter to queue everything, keeps a
// worst-case cycle bounded and predictable: ~10 accounts x 5s = ~50s, well inside the 10-minute
// schedule this runs on (moved from 5 min -- a 5-minute schedule would mean a ~50s-long Twitter
// pass overlapping the next GMGN-only pass more often than not).
const TWITTER_CHECK_DELAY_MS = 5_000;
const MAX_TWEETS_PER_ACCOUNT = 10;

/** Redis-based dedup keyed by transaction hash, not the (source_id, message_id) unique
 * constraint kolIngestWorker.ts relies on: every GMGN-sourced row has source_id = null, and
 * Postgres treats NULL as distinct from NULL in a unique index, so that constraint would not
 * actually stop duplicate inserts across repeated 5-minute runs. transaction_hash is a real,
 * permanently unique on-chain identifier, safe to use directly as the dedup key. */
async function processKolGmgnSync(trades: Awaited<ReturnType<typeof gmgnApi.getKolTrades>>): Promise<void> {
  if (trades.length === 0) return;

  let inserted = 0;

  for (const trade of trades) {
    if (trade.side !== "buy") continue; // "call" = a KOL buying, not selling

    const dedupeKey = `gmgnkol:seen:${trade.transactionHash}`;
    const isNew = await redis.set(dedupeKey, "1", "EX", DEDUPE_TTL_SECONDS, "NX");
    if (!isNew) continue;

    const priceAtCall = await jupiter.getPrice(trade.tokenAddress);

    const { error } = await supabase.from("kira_kol_calls").insert({
      source_id: null,
      source_user_id: null,
      source_type: "gmgn_kol",
      message_id: trade.transactionHash,
      token_address: trade.tokenAddress,
      called_at: new Date(trade.timestamp * 1000).toISOString(),
      price_at_call: priceAtCall,
      raw_text: trade.twitterUsername ? `GMGN KOL trade by @${trade.twitterUsername}` : "GMGN KOL trade",
    });

    if (error) {
      console.error("[kira-workers:kol-gmgn-sync] insert failed:", error.message);
      continue;
    }
    inserted++;
  }

  if (inserted > 0) {
    console.log(`[kira-workers:kol-gmgn-sync] ${inserted} new GMGN KOL calls recorded`);
  }
}

/** Twitter usernames worth checking for KOL calls this cycle: GMGN's own KOL trade feed already
 * carries a maker_info.twitter_username per trade (mapped as trade.twitterUsername), which is
 * the only real, currently-populated source of Twitter handles -- kira_kol_sources' 10 curated
 * rows are all platform 'telegram' today (verified live), none have a Twitter handle, though the
 * table's schema (platform + channel_identifier) already generically supports one if that
 * changes later, so that's included too rather than assuming it'll never happen. */
async function collectTwitterUsernamesToCheck(gmgnTrades: Awaited<ReturnType<typeof gmgnApi.getKolTrades>>): Promise<string[]> {
  const fromGmgn = gmgnTrades.map((t) => t.twitterUsername).filter((u): u is string => !!u);

  const { data: twitterSources, error } = await supabase
    .from("kira_kol_sources")
    .select("channel_identifier")
    .eq("platform", "twitter")
    .eq("active", true);
  if (error) {
    console.error("[kira-workers:kol-gmgn-sync] twitter source load failed:", error.message);
  }
  const fromSources = (twitterSources ?? []).map((s) => s.channel_identifier.replace(/^@/, ""));

  return [...new Set([...fromGmgn, ...fromSources])];
}

async function checkTwitterForKolCalls(usernames: string[]): Promise<number> {
  let inserted = 0;

  for (let i = 0; i < usernames.length; i++) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, TWITTER_CHECK_DELAY_MS));

    const username = usernames[i];
    const tweets = await twitter.getUserTweets(username, MAX_TWEETS_PER_ACCOUNT);

    for (const tweet of tweets) {
      const match = tweet.text.match(SOLANA_ADDRESS_RE);
      if (!match) continue;
      const tokenAddress = match[0];

      const dedupeKey = `twitterkol:seen:${tweet.id}`;
      const isNew = await redis.set(dedupeKey, "1", "EX", DEDUPE_TTL_SECONDS, "NX");
      if (!isNew) continue;

      const priceAtCall = await jupiter.getPrice(tokenAddress);

      const { error } = await supabase.from("kira_kol_calls").insert({
        source_id: null,
        source_user_id: null,
        source_type: "twitter",
        message_id: tweet.id,
        token_address: tokenAddress,
        called_at: new Date(tweet.createdAt).toISOString(),
        price_at_call: priceAtCall,
        raw_text: `@${username}: ${tweet.text.slice(0, 480)}`,
      });

      if (error) {
        if (error.code === "23505") continue; // already recorded
        console.error("[kira-workers:kol-gmgn-sync] twitter call insert failed:", error.message);
        continue;
      }
      inserted++;
    }
  }

  return inserted;
}

export function startKolGmgnSyncWorker(): Worker {
  return new Worker(
    "kira-kol-gmgn-sync",
    async () => {
      const trades = await gmgnApi.getKolTrades(100);
      await processKolGmgnSync(trades);

      const usernames = await collectTwitterUsernamesToCheck(trades);
      if (usernames.length === 0) return;
      const twitterInserted = await checkTwitterForKolCalls(usernames);
      if (twitterInserted > 0) {
        console.log(`[kira-workers:kol-gmgn-sync] ${twitterInserted} new Twitter KOL calls recorded`);
      }
    },
    { connection: bullConnection, concurrency: 1 },
  );
}
