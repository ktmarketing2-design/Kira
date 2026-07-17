import { Worker, type Job } from "bullmq";
import {
  dexscreener,
  rugcheck,
  goplus,
  helius,
  pumpfun,
  letsbonk,
  bags,
  raydiumLaunchlab,
  geckoterminal,
  lunarcrush,
  gmgnApi,
  detectLaunchpad,
  type HeliusConfig,
  type Launchpad,
  type SocialInsights,
  type GmgnEnrichment,
} from "@ceronix/kira-shared";
import { bullConnection } from "../lib/redis.js";
import { redis } from "../lib/redis.js";
import { supabase } from "../lib/supabase.js";
import { reserveGeminiBudget, generateText } from "../lib/gemini.js";
import { volumeQueue, volumeQueueEvents } from "../lib/queues.js";
import type { VolumeOutput } from "@ceronix/kira-shared";

const CACHE_TTL_SECONDS = 600;
const CHAIN_ID = "solana";

const heliusConfig: HeliusConfig = { apiKey: process.env.HELIUS_API_KEY ?? "" };

export interface DdCard {
  tokenAddress: string;
  symbol: string | null;
  name: string | null;
  chain: string;
  launchpad: Launchpad;
  graduated: boolean | null;
  marketDataSource: "dexscreener" | "geckoterminal" | "pumpfun" | "letsbonk" | "bags" | "raydium-launchlab" | "none";
  statusLabel: string;
  market: {
    fdvUsd: number | null;
    liquidityUsd: number | null;
    volume24hUsd: number | null;
    priceUsd: number | null;
    marketCapUsd: number | null;
    pairAddress: string | null;
    buys24h: number | null;
    sells24h: number | null;
    // DexScreener has no per-side USD volume, this is volume24hUsd split proportionally by
    // buys24h/sells24h counts, not a real measured value. Null whenever counts are unavailable.
    buyVolume24hUsd: number | null;
    sellVolume24hUsd: number | null;
  };
  topHolders: Array<{ address: string; pct: number | null; isDev: boolean }>;
  smartMoney: { walletsEntered24h: number; netFlowUsd: number } | null;
  deepIntel: GmgnEnrichment | null;
  safety: {
    mintAuthorityRevoked: boolean;
    freezeAuthorityRevoked: boolean;
    lpLocked: boolean;
    honeypotClean: boolean;
    top10HolderPct: number | null;
    deployerAddress: string | null;
    deployerPriorRugs: number;
    rugScore: number;
  };
  volume: VolumeOutput | null;
  /** LunarCrush data, stays in the card/schema for when the subscription is active, not the
   * primary display source, see socialSignals below for that. */
  social: SocialInsights | null;
  socialSignals: SocialSignals;
  verdictText: string;
  generatedAt: string;
}

export interface SocialSignals {
  kolMentions: number;
  totalTrackedChannels: number;
  trending: boolean;
}

interface DdJobData {
  tokenAddress: string;
  requestedBy?: string;
}

interface MarketData {
  fdvUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  priceUsd: number | null;
  marketCapUsd: number | null;
  source: DdCard["marketDataSource"];
  graduated: boolean | null;
  pairAddress?: string;
  dexId?: string;
  symbol: string | null;
  name: string | null;
  buys24h?: number | null;
  sells24h?: number | null;
}

const NO_MARKET_DATA: MarketData = {
  fdvUsd: null,
  liquidityUsd: null,
  volume24hUsd: null,
  priceUsd: null,
  marketCapUsd: null,
  source: "none",
  graduated: null,
  symbol: null,
  name: null,
};

/**
 * Market-data waterfall. DexScreener first (fastest, richest), then a launchpad-specific source
 * once we know which launchpad this mint is from, then GeckoTerminal as a generic catch-all,
 * and finally nothing at all, in which case the DD card still gets built from safety data alone.
 * Never throws, every branch is a soft fallback to the next.
 */
async function resolveMarketData(tokenAddress: string): Promise<{ data: MarketData; launchpad: Launchpad }> {
  const dexInfo = await dexscreener.getTokenInfo(CHAIN_ID, tokenAddress);
  const launchpad = detectLaunchpad(tokenAddress, dexInfo?.dexId);

  if (dexInfo && (dexInfo.liquidityUsd ?? 0) > 0) {
    return {
      launchpad,
      data: {
        fdvUsd: dexInfo.fdvUsd,
        liquidityUsd: dexInfo.liquidityUsd,
        volume24hUsd: dexInfo.volume24hUsd,
        priceUsd: dexInfo.priceUsd,
        marketCapUsd: dexInfo.fdvUsd,
        source: "dexscreener",
        graduated: launchpad === "unknown" ? null : true,
        pairAddress: dexInfo.pairAddress,
        dexId: dexInfo.dexId,
        symbol: dexInfo.symbol,
        name: dexInfo.name,
        buys24h: dexInfo.buys24h,
        sells24h: dexInfo.sells24h,
      },
    };
  }

  // DexScreener had nothing usable (typically a fresh pre-graduation token, or indexer lag).
  // Route to the launchpad-specific source next.
  if (launchpad === "pumpfun") {
    const coin = await pumpfun.getCoinInfo(tokenAddress);
    if (coin) {
      return {
        launchpad,
        data: {
          fdvUsd: coin.usdMarketCap,
          liquidityUsd: null, // bonding-curve virtual reserves, not a traditional liquidity pool
          volume24hUsd: null,
          priceUsd: null,
          marketCapUsd: coin.usdMarketCap,
          source: "pumpfun",
          graduated: coin.graduated,
          symbol: coin.symbol,
          name: coin.name,
        },
      };
    }
  } else if (launchpad === "letsbonk") {
    const coin = await letsbonk.getCoinInfo(tokenAddress);
    if (coin) {
      return {
        launchpad,
        data: {
          fdvUsd: coin.marketCap,
          liquidityUsd: null,
          volume24hUsd: null,
          priceUsd: null,
          marketCapUsd: coin.marketCap,
          source: "letsbonk",
          graduated: coin.graduated,
          symbol: coin.symbol,
          name: coin.name,
        },
      };
    }
  } else if (launchpad === "bags") {
    const coin = await bags.getCoinInfo(tokenAddress);
    if (coin) {
      return {
        launchpad,
        data: {
          fdvUsd: coin.marketCap,
          liquidityUsd: null,
          volume24hUsd: null,
          priceUsd: null,
          marketCapUsd: coin.marketCap,
          source: "bags",
          graduated: coin.graduated,
          symbol: coin.symbol,
          name: coin.name,
        },
      };
    }
  } else if (launchpad === "launchlab") {
    const pool = await raydiumLaunchlab.getPoolInfo(tokenAddress);
    if (pool) {
      return {
        launchpad,
        data: {
          fdvUsd: null,
          liquidityUsd: pool.liquidityUsd,
          volume24hUsd: pool.volume24hUsd,
          priceUsd: pool.priceUsd,
          marketCapUsd: null,
          source: "raydium-launchlab",
          graduated: null,
          symbol: null,
          name: null,
        },
      };
    }
  }
  // moonshot is DexScreener-operated (already tried above), and raydium/believe/heavendex/unknown
  // fall straight through to the generic GeckoTerminal lookup below.

  const geckoInfo = await geckoterminal.getTokenInfo(CHAIN_ID, tokenAddress);
  if (geckoInfo && (geckoInfo.priceUsd != null || geckoInfo.fdvUsd != null)) {
    return {
      launchpad,
      data: {
        fdvUsd: geckoInfo.fdvUsd,
        liquidityUsd: geckoInfo.liquidityUsd,
        volume24hUsd: geckoInfo.volume24hUsd,
        priceUsd: geckoInfo.priceUsd,
        marketCapUsd: geckoInfo.marketCapUsd,
        source: "geckoterminal",
        graduated: geckoInfo.graduated,
        symbol: geckoInfo.symbol,
        name: geckoInfo.name,
      },
    };
  }

  return { launchpad, data: NO_MARKET_DATA };
}

function buildStatusLabel(launchpad: Launchpad, market: MarketData): string {
  if (market.source === "none") {
    return "⚠️ No market data found. Safety analysis only.";
  }
  if (market.source === "dexscreener" && launchpad === "unknown") {
    return ""; // ordinary token with a real pair, no launchpad-status line needed
  }
  if (market.graduated === true) {
    const destination = launchpad === "pumpfun" ? "PumpSwap" : "Raydium";
    return `✅ Status: Graduated to ${destination}`;
  }
  if (market.graduated === false || market.source !== "dexscreener") {
    const label: Record<Launchpad, string> = {
      pumpfun: "Pump.fun",
      letsbonk: "LetsBONK",
      bags: "Bags",
      moonshot: "Moonshot",
      launchlab: "Raydium LaunchLab",
      believe: "Believe",
      heavendex: "HeavenDEX",
      raydium: "Raydium",
      unknown: "unknown launchpad",
    };
    return `📈 Status: Pre-graduation (bonding curve)\n🚀 Launchpad: ${label[launchpad]}`;
  }
  return "";
}

function computeRugScore(input: {
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
  lpLocked: boolean;
  isHoneypot: boolean;
  top10HolderPct: number | null;
  deployerPriorRugs: number;
}): number {
  let score = 100;
  if (!input.mintAuthorityRevoked) score -= 20;
  if (!input.freezeAuthorityRevoked) score -= 15;
  if (!input.lpLocked) score -= 25;
  if (input.isHoneypot) score -= 40;
  if ((input.top10HolderPct ?? 0) > 50) score -= 10;
  if (input.deployerPriorRugs > 0) score -= 30;
  return Math.max(0, Math.min(100, score));
}

const KOL_MENTION_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Zero-cost social signals built from data Kira already has (KOL call log) plus one free
 * DexScreener endpoint, used in place of LunarCrush for the card's displayed social section
 * since that requires a subscription tier this account does not have.
 */
async function resolveSocialSignals(tokenAddress: string): Promise<SocialSignals> {
  const since = new Date(Date.now() - KOL_MENTION_WINDOW_MS).toISOString();

  const [mentionsResult, totalSourcesResult, trending] = await Promise.all([
    supabase.from("kira_kol_calls").select("source_id").eq("token_address", tokenAddress).gte("called_at", since),
    supabase.from("kira_kol_sources").select("id", { count: "exact", head: true }).eq("active", true),
    dexscreener.isTokenTrending(CHAIN_ID, tokenAddress),
  ]);

  if (mentionsResult.error) {
    console.error("[kira-workers:dd] KOL mention lookup failed:", mentionsResult.error.message);
  }
  if (totalSourcesResult.error) {
    console.error("[kira-workers:dd] KOL source count failed:", totalSourcesResult.error.message);
  }

  const kolMentions = new Set((mentionsResult.data ?? []).map((r) => r.source_id)).size;
  const totalTrackedChannels = totalSourcesResult.count ?? 0;

  return { kolMentions, totalTrackedChannels, trending };
}

const SOCIAL_TIMEOUT_MS = 500;

/**
 * Races the LunarCrush call against a hard timeout so a slow/hanging endpoint never extends DD
 * card latency, resolves to null either way (the underlying fetch keeps running in the
 * background after "losing" the race, its result is just discarded, that's fine for a
 * best-effort social panel).
 */
function getSocialInsightsWithTimeout(symbol: string): Promise<SocialInsights | null> {
  return Promise.race([
    lunarcrush.getSocialInsights(symbol),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), SOCIAL_TIMEOUT_MS)),
  ]);
}

// GMGN's Deep Intel enrichment needs up to 9 sequential gmgn-cli calls under the client's own
// internal 1/sec rate limiter (concurrent bursts were verified live to trigger GMGN's rate limit
// and a temporary IP ban, so the client serializes everything itself -- see gmgn-api.ts). That's
// a real ~9s minimum on a true cold call, gated separately from the rest of the ddcard cache so a
// second cold DD for the same token within the cache window reuses this instead of re-paying it.
const DEEP_INTEL_TIMEOUT_MS = 12_000;

async function getGmgnEnrichmentCached(tokenAddress: string): Promise<GmgnEnrichment | null> {
  const cacheKey = `gmgn:enrichment:${tokenAddress}`;
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached) as GmgnEnrichment;

  const result = await Promise.race([
    gmgnApi.getEnrichment(tokenAddress),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), DEEP_INTEL_TIMEOUT_MS)),
  ]);

  if (result) {
    await redis.set(cacheKey, JSON.stringify(result), "EX", CACHE_TTL_SECONDS);
  }
  return result;
}

function defaultVerdictText(rugScore: number, volume: VolumeOutput | null, hasMarketData: boolean): string {
  const safety = rugScore >= 70 ? "looks relatively safe" : rugScore >= 40 ? "has some red flags" : "looks risky";
  const volumePart = volume ? ` Volume looks ${volume.verdict.replace("_", " ")}.` : "";
  const marketNote = hasMarketData ? "" : " No market data was available, this is safety analysis only.";
  return `Rug score ${rugScore}/100, this token ${safety}.${volumePart}${marketNote}`;
}

async function processDdJob(job: Job<DdJobData>): Promise<DdCard> {
  const { tokenAddress } = job.data;
  const cacheKey = `ddcard:${tokenAddress}`;

  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached) as DdCard;
  }

  const [report, security, holders, totalSupply, { data: market, launchpad }, socialSignals, gmgnEnrichment] =
    await Promise.all([
      rugcheck.getTokenReport(tokenAddress),
      goplus.getTokenSecurity(CHAIN_ID, tokenAddress),
      helius.getTokenLargestAccounts(heliusConfig, tokenAddress),
      helius.getTokenSupply(heliusConfig, tokenAddress),
      resolveMarketData(tokenAddress),
      resolveSocialSignals(tokenAddress),
      getGmgnEnrichmentCached(tokenAddress),
    ]);

  const deployerAddress = report?.deployerAddress ?? null;
  // Speed optimization (Sprint 5 Part 5): this used to also fetch the deployer's last 20 txs
  // sequentially here, a full extra Helius round-trip on the critical path of every cold DD, for
  // a value that was never actually surfaced anywhere in the card (`void deployerRecentTxs`
  // below used to mark exactly that). Cut entirely rather than left as dead weight.
  const deployerPriorRugs = report?.risks.some((r) => /rug/i.test(r.name)) ? 1 : 0;

  const symbol = market.symbol ?? report?.symbol ?? null;
  const name = market.name ?? report?.name ?? null;

  // Fired without awaiting yet, so it runs concurrently with the volume sub-job below rather
  // than adding to the critical path. Capped at 500ms via race, never blocks the card.
  const socialPromise = symbol ? getSocialInsightsWithTimeout(symbol) : Promise.resolve(null);

  // Pass the market data we already resolved straight to the volume sub-job, rather than
  // letting it re-derive fdv/liquidity from a kira_token_snapshots row that does not exist yet
  // on a token's first-ever lookup (that gap was defaulting vol/fdv-liq ratios to 0 for every
  // cold DD).
  const volumeJob = await volumeQueue.add(
    "volume",
    {
      tokenAddress,
      pairAddress: market.pairAddress,
      fdvUsd: market.fdvUsd ?? undefined,
      liquidityUsd: market.liquidityUsd ?? undefined,
    },
    { removeOnComplete: true, removeOnFail: true },
  );
  const volumePromise = volumeJob
    .waitUntilFinished(volumeQueueEvents, 12_000)
    .catch((err: unknown) => {
      console.error("[kira-workers:dd] volume subjob failed:", err instanceof Error ? err.message : err);
      return null;
    });

  const [volume, social] = await Promise.all([volumePromise, socialPromise]) as [
    VolumeOutput | null,
    SocialInsights | null,
  ];

  const rugScore = computeRugScore({
    mintAuthorityRevoked: report?.mintAuthorityRevoked ?? false,
    freezeAuthorityRevoked: report?.freezeAuthorityRevoked ?? false,
    lpLocked: report?.lpLocked ?? false,
    isHoneypot: security?.isHoneypot ?? false,
    top10HolderPct: report?.top10HolderPct ?? null,
    deployerPriorRugs,
  });

  const hasMarketData = market.source !== "none";
  const budgetOk = await reserveGeminiBudget("dd", 300);
  let verdictText = defaultVerdictText(rugScore, volume, hasMarketData);
  if (budgetOk) {
    const prompt =
      `Write one short, plain-English paragraph (max 3 sentences) summarizing this Solana ` +
      `token's risk profile for a trader. Rug safety score: ${rugScore}/100. ` +
      `Mint authority revoked: ${report?.mintAuthorityRevoked ?? "unknown"}. ` +
      `LP locked: ${report?.lpLocked ?? "unknown"}. ` +
      `Honeypot: ${security?.isHoneypot ?? "unknown"}. ` +
      `Volume verdict: ${volume?.verdict ?? "unknown"}. ` +
      `Market data available: ${hasMarketData}. No markdown, no disclaimers.`;
    const generated = await generateText(prompt);
    if (generated) verdictText = generated.trim();
  }

  let buyVolume24hUsd: number | null = null;
  let sellVolume24hUsd: number | null = null;
  const totalTxns24h = (market.buys24h ?? 0) + (market.sells24h ?? 0);
  if (market.buys24h != null && market.sells24h != null && market.volume24hUsd != null && totalTxns24h > 0) {
    buyVolume24hUsd = (market.volume24hUsd * market.buys24h) / totalTxns24h;
    sellVolume24hUsd = (market.volume24hUsd * market.sells24h) / totalTxns24h;
  }

  // Top 5 by raw token-account balance (not owner-deduplicated, see helius.ts). LP-wallet
  // detection is not implemented, there is no reliable LP account address available from any
  // current data source, only deployer-wallet detection (via RugCheck's deployerAddress) works.
  const topHolders = holders.slice(0, 5).map((h) => ({
    address: h.address,
    pct: totalSupply && totalSupply > 0 && h.uiAmount != null ? (h.uiAmount / totalSupply) * 100 : null,
    isDev: h.address === deployerAddress,
  }));

  let smartMoney: DdCard["smartMoney"] = null;
  {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: events, error: smartMoneyError } = await supabase
      .from("kira_smart_money_events")
      .select("wallet_address, side, usd_value")
      .eq("token_address", tokenAddress)
      .gte("block_time", since);

    if (smartMoneyError) {
      console.error("[kira-workers:dd] smart money lookup failed:", smartMoneyError.message);
    } else if (events && events.length > 0) {
      const uniqueWallets = new Set(events.map((e) => e.wallet_address));
      const netFlowUsd = events.reduce(
        (sum, e) => sum + (e.side === "buy" ? (e.usd_value ?? 0) : -(e.usd_value ?? 0)),
        0,
      );
      smartMoney = { walletsEntered24h: uniqueWallets.size, netFlowUsd };
    }
  }

  const card: DdCard = {
    tokenAddress,
    symbol,
    name,
    chain: CHAIN_ID,
    launchpad,
    graduated: market.graduated,
    marketDataSource: market.source,
    statusLabel: buildStatusLabel(launchpad, market),
    market: {
      fdvUsd: market.fdvUsd,
      liquidityUsd: market.liquidityUsd,
      volume24hUsd: market.volume24hUsd,
      priceUsd: market.priceUsd,
      marketCapUsd: market.marketCapUsd,
      pairAddress: market.pairAddress ?? null,
      buys24h: market.buys24h ?? null,
      sells24h: market.sells24h ?? null,
      buyVolume24hUsd: buyVolume24hUsd,
      sellVolume24hUsd: sellVolume24hUsd,
    },
    topHolders: topHolders,
    smartMoney,
    deepIntel: gmgnEnrichment,
    safety: {
      mintAuthorityRevoked: report?.mintAuthorityRevoked ?? false,
      freezeAuthorityRevoked: report?.freezeAuthorityRevoked ?? false,
      lpLocked: report?.lpLocked ?? false,
      honeypotClean: !(security?.isHoneypot ?? false),
      top10HolderPct: report?.top10HolderPct ?? null,
      deployerAddress,
      deployerPriorRugs,
      rugScore,
    },
    volume,
    social,
    socialSignals,
    verdictText,
    generatedAt: new Date().toISOString(),
  };

  await redis.set(cacheKey, JSON.stringify(card), "EX", CACHE_TTL_SECONDS);

  const { error } = await supabase.from("kira_token_snapshots").insert({
    token_address: tokenAddress,
    chain: CHAIN_ID,
    fdv_usd: card.market.fdvUsd,
    liquidity_usd: card.market.liquidityUsd,
    volume_24h_usd: card.market.volume24hUsd,
    mint_authority_revoked: card.safety.mintAuthorityRevoked,
    freeze_authority_revoked: card.safety.freezeAuthorityRevoked,
    lp_locked: card.safety.lpLocked,
    honeypot_clean: card.safety.honeypotClean,
    top10_holder_pct: card.safety.top10HolderPct,
    deployer_address: card.safety.deployerAddress,
    deployer_prior_rugs: card.safety.deployerPriorRugs,
    rug_score: card.safety.rugScore,
    vol_liq_ratio: volume?.signals.find((s) => s.name === "vol_liq_ratio")?.value ?? null,
    fdv_liq_ratio: volume?.signals.find((s) => s.name === "fdv_liq_ratio")?.value ?? null,
    volume_score: volume?.score ?? null,
    volume_verdict: volume?.verdict ?? null,
    verdict_text: card.verdictText,
    social_mindshare: social?.mindshare ?? null,
    social_mindshare_change: social?.mindshareChange ?? null,
    social_sentiment: social?.sentiment ?? null,
    social_galaxy_score: social?.galaxyScore ?? null,
    social_top_influencers: social?.topInfluencers ?? null,
    social_kol_mentions: socialSignals.kolMentions,
    social_trending: socialSignals.trending,
    // GMGN Deep Intel (Sprint 7 Part 1). wash_trade and rug_ratio are NOT populated -- neither
    // field exists anywhere in GMGN's token info or security responses (checked both live
    // against BONK before building this), so migration 010's columns for them stay null rather
    // than being filled with a fabricated value.
    smart_degen_count: gmgnEnrichment?.smartDegenCount ?? null,
    renowned_wallets: gmgnEnrichment?.renownedWallets ?? null,
    rat_trader_rate: gmgnEnrichment?.ratTraderSamplePct ?? null,
    bundler_rate: gmgnEnrichment?.bundlerSamplePct ?? null,
    sniper_count: gmgnEnrichment?.sniperCount ?? null,
    fresh_wallet_rate: gmgnEnrichment?.freshWalletSamplePct ?? null,
    dev_holding_pct: gmgnEnrichment?.devHoldingPct ?? null,
  });

  if (error) {
    console.error("[kira-workers:dd] snapshot persist failed:", error.message);
  }

  return card;
}

export function startDdWorker(): Worker<DdJobData, DdCard> {
  return new Worker<DdJobData, DdCard>("kira-dd", processDdJob, {
    connection: bullConnection,
    concurrency: 5,
  });
}
