import { z } from "zod";
import { RateLimiter } from "./rateLimiter.js";
import { KiraClientError, logClientFailure } from "./errors.js";

const SOURCE = "dexscreener";
const BASE_URL = "https://api.dexscreener.com";

// 300 requests/minute per DexScreener's published limit.
const limiter = new RateLimiter(300, 60_000);

const dexScreenerTokenSchema = z.object({
  chainId: z.string(),
  dexId: z.string(),
  pairAddress: z.string(),
  baseToken: z.object({
    address: z.string(),
    name: z.string().optional(),
    symbol: z.string().optional(),
  }),
  priceUsd: z.string().optional(),
  fdv: z.number().optional(),
  liquidity: z.object({ usd: z.number().optional() }).optional(),
  volume: z.object({ h24: z.number().optional() }).optional(),
});

const dexScreenerSearchResponseSchema = z.object({
  pairs: z.array(dexScreenerTokenSchema).nullable(),
});

export type DexScreenerPair = z.infer<typeof dexScreenerTokenSchema>;

export interface TokenInfo {
  priceUsd: number | null;
  fdvUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  pairAddress: string;
  dexId: string;
  symbol: string | null;
  name: string | null;
}

const boostSchema = z.object({
  chainId: z.string(),
  tokenAddress: z.string(),
});
const boostsResponseSchema = z.array(boostSchema);

async function request<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  await limiter.acquire();
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      headers: { accept: "application/json" },
    });
  } catch (err) {
    throw new KiraClientError(SOURCE, "network request failed", { cause: err });
  }
  if (!res.ok) {
    throw new KiraClientError(SOURCE, `unexpected status ${res.status}`, { status: res.status });
  }
  const json = await res.json();
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new KiraClientError(SOURCE, `response validation failed: ${parsed.error.message}`);
  }
  return parsed.data;
}

/** Search by symbol or token address. Returns raw pairs, caller picks the most liquid one. */
export async function searchTokens(query: string): Promise<DexScreenerPair[]> {
  try {
    const data = await request(
      `/latest/dex/search?q=${encodeURIComponent(query)}`,
      dexScreenerSearchResponseSchema,
    );
    return data.pairs ?? [];
  } catch (err) {
    logClientFailure(SOURCE, err);
    return [];
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Best-liquidity pair for a token on a given chain, or null if not found / on failure.
 *
 * Rejects price outliers before picking by liquidity: live testing turned up a real case (BONK)
 * where one indexed pair reported ~$100M liquidity but a price ~5000x every other pair for the
 * same token (29 other pairs agreed with each other within a few percent), almost certainly bad
 * indexing on DexScreener's side for that one pool rather than real market state. Naively always
 * trusting "highest liquidity" let that single bad pair corrupt the whole card (FDV off by
 * 5000x). Pairs priced more than 3x away from the cross-pair median are excluded before the
 * liquidity pick; if that leaves nothing (e.g. only one pair exists), fall back to the original
 * highest-liquidity pick rather than returning nothing.
 */
export async function getTokenInfo(chainId: string, address: string): Promise<TokenInfo | null> {
  try {
    const data = await request(`/latest/dex/tokens/${address}`, dexScreenerSearchResponseSchema);
    const pairs = (data.pairs ?? []).filter((p) => p.chainId === chainId);
    if (pairs.length === 0) return null;

    const prices = pairs.map((p) => (p.priceUsd ? Number(p.priceUsd) : null)).filter((p): p is number => p != null);
    const medianPrice = prices.length > 0 ? median(prices) : null;

    const sane =
      medianPrice != null && medianPrice > 0
        ? pairs.filter((p) => {
            const price = p.priceUsd ? Number(p.priceUsd) : null;
            if (price == null) return true; // no price to judge, don't exclude on this basis
            const ratio = price / medianPrice;
            return ratio > 1 / 3 && ratio < 3;
          })
        : pairs;
    const candidates = sane.length > 0 ? sane : pairs;

    const best = candidates.reduce((a, b) =>
      (b.liquidity?.usd ?? 0) > (a.liquidity?.usd ?? 0) ? b : a,
    );

    return {
      priceUsd: best.priceUsd ? Number(best.priceUsd) : null,
      fdvUsd: best.fdv ?? null,
      liquidityUsd: best.liquidity?.usd ?? null,
      volume24hUsd: best.volume?.h24 ?? null,
      pairAddress: best.pairAddress,
      dexId: best.dexId,
      symbol: best.baseToken.symbol ?? null,
      name: best.baseToken.name ?? null,
    };
  } catch (err) {
    logClientFailure(SOURCE, err);
    return null;
  }
}

/**
 * `/token-boosts/active/v1` (as sometimes referenced) does not exist on the real API, verified
 * live: 404. The real endpoint is `/token-boosts/latest/v1` (currently/recently active paid
 * boosts), used here instead, same intent. Returns false on any failure, a trending flag is
 * cosmetic, never worth failing the DD card over.
 */
export async function isTokenTrending(chainId: string, address: string): Promise<boolean> {
  try {
    const boosts = await request("/token-boosts/latest/v1", boostsResponseSchema);
    return boosts.some((b) => b.chainId === chainId && b.tokenAddress.toLowerCase() === address.toLowerCase());
  } catch (err) {
    logClientFailure(SOURCE, err);
    return false;
  }
}
