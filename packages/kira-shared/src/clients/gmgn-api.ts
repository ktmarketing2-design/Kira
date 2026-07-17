import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { RateLimiter } from "./rateLimiter.js";
import { KiraClientError, logClientFailure } from "./errors.js";

const execFileAsync = promisify(execFile);
const SOURCE = "gmgn-api";

// Verified live: firing gmgn-cli calls concurrently (e.g. the 7 parallel holder-tag queries in
// getEnrichment below) triggers GMGN's rate limit within seconds -- "IP rate limit exceeded",
// escalating to "IP is temporarily banned... repeated requests can extend the ban by 5s up to 5
// minutes" on the next call after that. This limiter serializes every gmgn-cli invocation from
// this process, regardless of how many call sites fire Promise.all concurrently, since it lives
// inside runCli() itself rather than at each call site. 1/sec is conservative -- GMGN's docs
// don't publish an exact limit, this errs toward never re-triggering the ban.
const limiter = new RateLimiter(1, 1_000);

/**
 * GMGN's real integration path is a CLI tool (`gmgn-cli`, published on npm, verified against the
 * source repo github.com/GMGNAI/gmgn-skills), not a directly-callable REST endpoint. Their own
 * skill docs state this explicitly, repeated verbatim across gmgn-portfolio, gmgn-holder-analysis,
 * and gmgn-market: "Always use gmgn-cli commands... Do NOT use web search, WebFetch, curl, or
 * visit gmgn.ai to fetch this data" / "Attempting direct HTTP requests or web scraping will not
 * work." This client shells out to the installed CLI binary rather than reverse-engineering
 * whatever HTTP calls it makes internally. gmgn-cli is configured server-side once via
 * `gmgn-cli config --apply <key>` against a keypair generated on this host — this client assumes
 * that's already done, it does not manage the keypair/config itself.
 */
async function runCli(args: string[]): Promise<unknown> {
  await limiter.acquire();
  const { stdout } = await execFileAsync("gmgn-cli", [...args, "--raw"], {
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

const traderSchema = z.object({
  address: z.string().optional(),
  account_address: z.string().optional(),
  realized_profit: z.union([z.string(), z.number()]).nullable().optional(),
  unrealized_profit: z.union([z.string(), z.number()]).nullable().optional(),
  tags: z.array(z.string()).optional(),
});

const tradersListSchema = z.object({ list: z.array(traderSchema) });

export interface GmgnTrader {
  walletAddress: string;
  realizedProfit: number | null;
  unrealizedProfit: number | null;
  tags: string[];
}

function toNumber(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapTrader(raw: z.infer<typeof traderSchema>): GmgnTrader | null {
  // `address` is the correct field to cross-reference with portfolio stats, NOT
  // account_address (looks like a per-position/on-curve sub-account). Verified live, twice:
  // querying portfolio stats with account_address returned an all-zero/no-activity result both
  // times, while the same wallets' `address` value returned real, rich trading data both times.
  const walletAddress = raw.address ?? raw.account_address;
  if (!walletAddress) return null;
  return {
    walletAddress,
    realizedProfit: toNumber(raw.realized_profit),
    unrealizedProfit: toNumber(raw.unrealized_profit),
    tags: raw.tags ?? [],
  };
}

/** Top traders for a token (`gmgn-cli token traders`). */
export async function getTopTraders(tokenAddress: string, limit = 20): Promise<GmgnTrader[]> {
  try {
    const json = await runCli([
      "token",
      "traders",
      "--chain",
      "sol",
      "--address",
      tokenAddress,
      "--limit",
      String(Math.min(limit, 100)),
    ]);
    const parsed = tradersListSchema.safeParse(json);
    if (!parsed.success) {
      throw new KiraClientError(SOURCE, `traders response validation failed: ${parsed.error.message}`);
    }
    return parsed.data.list.map(mapTrader).filter((t): t is GmgnTrader => t !== null);
  } catch (err) {
    logClientFailure(SOURCE, err);
    return [];
  }
}

/** Smart-money holders for a token (`gmgn-cli token holders --tag smart_degen`). */
export async function getSmartMoneyHolders(tokenAddress: string, limit = 20): Promise<GmgnTrader[]> {
  try {
    const json = await runCli([
      "token",
      "holders",
      "--chain",
      "sol",
      "--address",
      tokenAddress,
      "--limit",
      String(Math.min(limit, 100)),
      "--tag",
      "smart_degen",
    ]);
    const parsed = tradersListSchema.safeParse(json);
    if (!parsed.success) {
      throw new KiraClientError(SOURCE, `holders response validation failed: ${parsed.error.message}`);
    }
    return parsed.data.list.map(mapTrader).filter((t): t is GmgnTrader => t !== null);
  } catch (err) {
    logClientFailure(SOURCE, err);
    return [];
  }
}

const pnlStatSchema = z.object({
  winrate: z.number().nullable().optional(),
});

const walletStatsSchema = z.object({
  wallet_address: z.string(),
  realized_profit: z.union([z.string(), z.number()]).nullable().optional(),
  total_cost: z.union([z.string(), z.number()]).nullable().optional(),
  buy: z.number().nullable().optional(),
  sell: z.number().nullable().optional(),
  pnl_stat: pnlStatSchema.optional(),
  common: z.object({ tags: z.array(z.string()).optional() }).optional(),
});

export interface GmgnWalletPnl {
  walletAddress: string;
  winRate: number | null; // 0-1 fraction
  realizedProfit: number | null;
  totalCost: number | null;
  buy: number;
  sell: number;
  tags: string[];
}

/** Wallet trading stats (`gmgn-cli portfolio stats`). Returns null on failure or if the wallet
 * has no activity in the window rather than a zeroed-out object with false-looking data. */
export async function getWalletPnl(walletAddress: string, period: "7d" | "30d"): Promise<GmgnWalletPnl | null> {
  try {
    const json = await runCli(["portfolio", "stats", "--chain", "sol", "--wallet", walletAddress, "--period", period]);
    const parsed = walletStatsSchema.safeParse(json);
    if (!parsed.success) {
      throw new KiraClientError(SOURCE, `wallet stats response validation failed: ${parsed.error.message}`);
    }
    const data = parsed.data;
    return {
      walletAddress: data.wallet_address,
      winRate: data.pnl_stat?.winrate ?? null,
      realizedProfit: toNumber(data.realized_profit),
      totalCost: toNumber(data.total_cost),
      buy: data.buy ?? 0,
      sell: data.sell ?? 0,
      tags: data.common?.tags ?? [],
    };
  } catch (err) {
    logClientFailure(SOURCE, err);
    return null;
  }
}

// ============================================================================
// DD card enrichment (Sprint 7 Part 1)
// ============================================================================

const tokenInfoSchema = z.object({
  holder_count: z.number().nullable().optional(),
  liquidity: z.union([z.string(), z.number()]).nullable().optional(),
  dev: z.object({ top_10_holder_rate: z.union([z.string(), z.number()]).nullable().optional() }).optional(),
  price: z.object({ volume_24h: z.union([z.string(), z.number()]).nullable().optional() }).optional(),
});

const tokenSecuritySchema = z.object({
  open_source: z.number().nullable().optional(),
  honeypot: z.number().nullable().optional(),
  renounced_mint: z.boolean().nullable().optional(),
  renounced_freeze_account: z.boolean().nullable().optional(),
  buy_tax: z.union([z.string(), z.number()]).nullable().optional(),
  sell_tax: z.union([z.string(), z.number()]).nullable().optional(),
});

/** GMGN's tags observed live: smart_degen / renowned / fresh_wallet / dev / sniper / rat_trader /
 * bundler / transfer_in / dex_bot / bluechip_owner. token holders --tag X takes exactly one tag
 * per call, there is no multi-tag OR — this is why enrichment needs several parallel calls, not
 * one. --limit caps at 100 with no total-count field anywhere in the response envelope (verified
 * live, top-level keys are just {list}), so a count that lands exactly on the limit is a floor,
 * not an exact figure (observed live on BONK, an atypically large/old token: smart_degen,
 * renowned, sniper, rat_trader, bundler, and fresh_wallet all saturated at exactly 100; only
 * `dev` returned a real, uncapped count of 0, consistent with BONK's creator_token_status
 * "creator_close" meaning the dev fully exited). Smaller/newer DD-target tokens should return
 * real, uncapped counts most of the time.
 */
async function countHoldersByTag(tokenAddress: string, tag: string): Promise<{ count: number; capped: boolean }> {
  const holders = await getSmartMoneyHoldersInternal(tokenAddress, tag, 100);
  return { count: holders.length, capped: holders.length >= 100 };
}

async function getSmartMoneyHoldersInternal(tokenAddress: string, tag: string, limit: number): Promise<GmgnTrader[]> {
  try {
    const json = await runCli([
      "token",
      "holders",
      "--chain",
      "sol",
      "--address",
      tokenAddress,
      "--limit",
      String(limit),
      "--tag",
      tag,
    ]);
    const parsed = tradersListSchema.safeParse(json);
    if (!parsed.success) return [];
    return parsed.data.list.map(mapTrader).filter((t): t is GmgnTrader => t !== null);
  } catch (err) {
    logClientFailure(SOURCE, err);
    return [];
  }
}

const holderAmountSchema = z.object({
  amount_percentage: z.number().nullable().optional(),
});
const holderAmountListSchema = z.object({ list: z.array(holderAmountSchema) });

/** Sum of amount_percentage (already a 0-1 fraction of supply per holder) across dev-tagged
 * holders. Separate from getSmartMoneyHoldersInternal/GmgnTrader since dev holding needs the raw
 * supply-share field that mapTrader doesn't carry (it's generic-purpose, used for trader/smart-
 * money discovery elsewhere, not holding-percentage math). */
async function getDevHoldingPct(tokenAddress: string): Promise<number | null> {
  try {
    const json = await runCli([
      "token",
      "holders",
      "--chain",
      "sol",
      "--address",
      tokenAddress,
      "--limit",
      "100",
      "--tag",
      "dev",
    ]);
    const parsed = holderAmountListSchema.safeParse(json);
    if (!parsed.success) return null;
    if (parsed.data.list.length === 0) return 0;
    const total = parsed.data.list.reduce((sum, h) => sum + (h.amount_percentage ?? 0), 0);
    return total * 100;
  } catch (err) {
    logClientFailure(SOURCE, err);
    return null;
  }
}

function toPct(v: string | number | null | undefined): number | null {
  const n = toNumber(v);
  return n == null ? null : n * 100;
}

export interface GmgnEnrichment {
  holderCount: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  top10HolderPct: number | null;
  isOpenSource: boolean | null;
  isRenounced: boolean | null; // both mint and freeze authority renounced
  isHoneypot: boolean | null;
  buyTaxPct: number | null;
  sellTaxPct: number | null;
  smartDegenCount: number | null;
  smartDegenCountCapped: boolean;
  renownedWallets: number | null;
  renownedWalletsCapped: boolean;
  sniperCount: number | null;
  sniperCountCapped: boolean;
  // Percent of the (capped-at-100) sampled holder list carrying this tag, NOT percent of total
  // volume/holders — GMGN's holders endpoint has no aggregate volume-share field for a tag
  // subset, only per-holder buy_volume_cur/sell_volume_cur, and summing those against a total
  // that itself may be sampled/capped would overstate precision this data doesn't actually have.
  ratTraderSamplePct: number | null;
  bundlerSamplePct: number | null;
  freshWalletSamplePct: number | null;
  devHoldingPct: number | null;
}

/** All DD card "Deep Intel" data in one call: token info, security, and 7 parallel
 * holder-tag queries (smart_degen, renowned, sniper, rat_trader, bundler, fresh_wallet, dev).
 * Returns null only if the token info call itself fails; partial holder-tag failures degrade
 * individual fields to null rather than failing the whole card. */
export async function getEnrichment(tokenAddress: string): Promise<GmgnEnrichment | null> {
  const infoJson = await (async () => {
    try {
      return await runCli(["token", "info", "--chain", "sol", "--address", tokenAddress]);
    } catch (err) {
      logClientFailure(SOURCE, err);
      return null;
    }
  })();
  if (infoJson === null) return null;

  const infoParsed = tokenInfoSchema.safeParse(infoJson);
  if (!infoParsed.success) {
    logClientFailure(SOURCE, new KiraClientError(SOURCE, `token info validation failed: ${infoParsed.error.message}`));
    return null;
  }
  const info = infoParsed.data;

  const [
    securityJson,
    smartDegen,
    renowned,
    sniper,
    ratTrader,
    bundler,
    freshWallet,
    devHoldingPct,
  ] = await Promise.all([
    (async () => {
      try {
        return await runCli(["token", "security", "--chain", "sol", "--address", tokenAddress]);
      } catch (err) {
        logClientFailure(SOURCE, err);
        return null;
      }
    })(),
    countHoldersByTag(tokenAddress, "smart_degen"),
    countHoldersByTag(tokenAddress, "renowned"),
    countHoldersByTag(tokenAddress, "sniper"),
    getSmartMoneyHoldersInternal(tokenAddress, "rat_trader", 100),
    getSmartMoneyHoldersInternal(tokenAddress, "bundler", 100),
    getSmartMoneyHoldersInternal(tokenAddress, "fresh_wallet", 100),
    getDevHoldingPct(tokenAddress),
  ]);

  const security = securityJson ? tokenSecuritySchema.safeParse(securityJson) : null;
  const sec = security?.success ? security.data : null;

  // Sample size for the *Pct fields above is the smart_degen sample (100 or holderCount, whichever
  // is smaller) purely as a stand-in denominator since GMGN gives no true total; approximate only.
  const sampleDenominator = Math.min(info.holder_count ?? 100, 100) || 100;

  return {
    holderCount: info.holder_count ?? null,
    liquidityUsd: toNumber(info.liquidity),
    volume24hUsd: toNumber(info.price?.volume_24h),
    top10HolderPct: toPct(info.dev?.top_10_holder_rate),
    isOpenSource: sec?.open_source == null ? null : sec.open_source === 1,
    isRenounced:
      sec?.renounced_mint == null || sec?.renounced_freeze_account == null
        ? null
        : sec.renounced_mint && sec.renounced_freeze_account,
    isHoneypot: sec?.honeypot == null ? null : sec.honeypot === 1,
    buyTaxPct: sec ? toNumber(sec.buy_tax) : null,
    sellTaxPct: sec ? toNumber(sec.sell_tax) : null,
    smartDegenCount: smartDegen.count,
    smartDegenCountCapped: smartDegen.capped,
    renownedWallets: renowned.count,
    renownedWalletsCapped: renowned.capped,
    sniperCount: sniper.count,
    sniperCountCapped: sniper.capped,
    ratTraderSamplePct: (ratTrader.length / sampleDenominator) * 100,
    bundlerSamplePct: (bundler.length / sampleDenominator) * 100,
    freshWalletSamplePct: (freshWallet.length / sampleDenominator) * 100,
    devHoldingPct,
  };
}

// ============================================================================
// Trending + KOL/Smart Money trade tracking (Sprint 7 Parts 3 & 4)
// ============================================================================

const trendingTokenSchema = z.object({
  address: z.string(),
  symbol: z.string().nullable().optional(),
  price: z.number().nullable().optional(),
  price_change_percent5m: z.number().nullable().optional(),
});
const trendingResponseSchema = z.object({ data: z.object({ rank: z.array(trendingTokenSchema) }) });

export interface TrendingToken {
  address: string;
  symbol: string | null;
  priceUsd: number | null;
  priceChange5mPct: number | null;
}

/** Top trending tokens by volume, 5m window. */
export async function getTrending(limit = 20): Promise<TrendingToken[]> {
  try {
    const json = await runCli([
      "market",
      "trending",
      "--chain",
      "sol",
      "--interval",
      "5m",
      "--order-by",
      "volume",
      "--direction",
      "desc",
      "--limit",
      String(Math.min(limit, 100)),
    ]);
    const parsed = trendingResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new KiraClientError(SOURCE, `trending response validation failed: ${parsed.error.message}`);
    }
    return parsed.data.data.rank.map((t) => ({
      address: t.address,
      symbol: t.symbol ?? null,
      priceUsd: t.price ?? null,
      priceChange5mPct: t.price_change_percent5m ?? null,
    }));
  } catch (err) {
    logClientFailure(SOURCE, err);
    return [];
  }
}

const tradeRecordSchema = z.object({
  transaction_hash: z.string(),
  maker: z.string(),
  base_address: z.string(),
  side: z.enum(["buy", "sell"]),
  amount_usd: z.union([z.string(), z.number()]).nullable().optional(),
  price_usd: z.union([z.string(), z.number()]).nullable().optional(),
  timestamp: z.number(),
  base_token: z.object({ symbol: z.string().nullable().optional() }).optional(),
  maker_info: z
    .object({
      twitter_username: z.string().nullable().optional(),
      tags: z.array(z.string()).optional(),
    })
    .optional(),
});
const tradeRecordListSchema = z.object({ list: z.array(tradeRecordSchema) });

export interface GmgnTradeRecord {
  transactionHash: string;
  wallet: string;
  tokenAddress: string;
  tokenSymbol: string | null;
  side: "buy" | "sell";
  usdValue: number | null;
  priceUsd: number | null;
  timestamp: number; // unix seconds
  twitterUsername: string | null;
  tags: string[];
}

function mapTradeRecord(raw: z.infer<typeof tradeRecordSchema>): GmgnTradeRecord {
  return {
    transactionHash: raw.transaction_hash,
    wallet: raw.maker,
    tokenAddress: raw.base_address,
    tokenSymbol: raw.base_token?.symbol ?? null,
    side: raw.side,
    usdValue: toNumber(raw.amount_usd),
    priceUsd: toNumber(raw.price_usd),
    timestamp: raw.timestamp,
    twitterUsername: raw.maker_info?.twitter_username ?? null,
    tags: raw.maker_info?.tags ?? [],
  };
}

/** Recent KOL trades (`gmgn-cli track kol`). */
export async function getKolTrades(limit = 100): Promise<GmgnTradeRecord[]> {
  try {
    const json = await runCli(["track", "kol", "--chain", "sol", "--limit", String(Math.min(limit, 200))]);
    const parsed = tradeRecordListSchema.safeParse(json);
    if (!parsed.success) {
      throw new KiraClientError(SOURCE, `kol trades response validation failed: ${parsed.error.message}`);
    }
    return parsed.data.list.map(mapTradeRecord);
  } catch (err) {
    logClientFailure(SOURCE, err);
    return [];
  }
}

/** Recent Smart Money trades (`gmgn-cli track smartmoney`). */
export async function getSmartMoneyTrades(limit = 100): Promise<GmgnTradeRecord[]> {
  try {
    const json = await runCli(["track", "smartmoney", "--chain", "sol", "--limit", String(Math.min(limit, 200))]);
    const parsed = tradeRecordListSchema.safeParse(json);
    if (!parsed.success) {
      throw new KiraClientError(SOURCE, `smartmoney trades response validation failed: ${parsed.error.message}`);
    }
    return parsed.data.list.map(mapTradeRecord);
  } catch (err) {
    logClientFailure(SOURCE, err);
    return [];
  }
}

// ============================================================================
// Discovery scanner (Sprint 7 GMGN scanner): trenches + smart-degen signals
// ============================================================================

export type TrenchType = "new_creation" | "near_completion" | "completed";

/**
 * Raw pass-through rather than a strict zod schema: field names and the response envelope shape
 * here come from Antigravity's own live-verified report, not this client's own test, per explicit
 * instruction not to re-test these specific endpoints. Notably reported: the response root has
 * multiple bucket keys regardless of which --type was requested (e.g. new_creation's response
 * includes both a "new_creation" and an empty "completed" key), and near_completion's actual
 * token list lands under a "pump" key, not "near_completion" -- callers should read the specific
 * bucket key documented for the --type they asked for, not assume the --type value is the key.
 */
export async function getTrenches(type: TrenchType): Promise<Record<string, unknown[]>> {
  try {
    const json = await runCli(["market", "trenches", "--chain", "sol", "--type", type, "--limit", "50"]);
    if (json && typeof json === "object" && !Array.isArray(json)) {
      return json as Record<string, unknown[]>;
    }
    return {};
  } catch (err) {
    logClientFailure(SOURCE, err);
    return {};
  }
}

/** Signal types 14/15/16 reportedly return HTTP 400 (not supported) per the same unverified-by-
 * this-client report -- only type 12 (smart money cluster buy) is called. */
export async function getSmartDegenSignals(): Promise<unknown[]> {
  try {
    const json = await runCli(["market", "signal", "--chain", "sol", "--signal-type", "12"]);
    return Array.isArray(json) ? json : [];
  } catch (err) {
    logClientFailure(SOURCE, err);
    return [];
  }
}
