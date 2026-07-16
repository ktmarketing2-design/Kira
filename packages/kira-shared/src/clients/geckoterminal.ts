import { z } from "zod";
import { RateLimiter } from "./rateLimiter.js";
import { KiraClientError, logClientFailure } from "./errors.js";

const SOURCE = "geckoterminal";
const BASE_URL = "https://api.geckoterminal.com/api/v2";

// Published free-tier limit: 30 requests/minute.
const limiter = new RateLimiter(30, 60_000);

const ohlcvResponseSchema = z.object({
  data: z.object({
    attributes: z.object({
      ohlcv_list: z.array(z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()])),
    }),
  }),
});

const poolInfoResponseSchema = z.object({
  data: z.object({
    attributes: z.object({
      base_token_price_usd: z.string().nullable().optional(),
      fdv_usd: z.string().nullable().optional(),
      reserve_in_usd: z.string().nullable().optional(),
      volume_usd: z.object({ h24: z.string().nullable().optional() }).optional(),
    }),
  }),
});

// Verified live against /networks/solana/tokens/{address}: works directly off a mint address, no
// pool address needed, includes launchpad_details for pre-graduation bonding-curve tokens.
const tokenInfoResponseSchema = z.object({
  data: z.object({
    attributes: z.object({
      name: z.string().nullable().optional(),
      symbol: z.string().nullable().optional(),
      price_usd: z.string().nullable().optional(),
      fdv_usd: z.string().nullable().optional(),
      total_reserve_in_usd: z.string().nullable().optional(),
      volume_usd: z.object({ h24: z.string().nullable().optional() }).optional(),
      market_cap_usd: z.string().nullable().optional(),
      launchpad_details: z
        .object({
          graduation_percentage: z.number().nullable().optional(),
          completed: z.boolean().nullable().optional(),
        })
        .nullable()
        .optional(),
    }),
  }),
});

export interface TokenInfo {
  priceUsd: number | null;
  fdvUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  marketCapUsd: number | null;
  graduationPct: number | null;
  graduated: boolean | null;
  symbol: string | null;
  name: string | null;
}

export interface OhlcvCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PoolInfo {
  priceUsd: number | null;
  fdvUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
}

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

/** timeframe: 'day' | 'hour' | 'minute' per GeckoTerminal's OHLCV endpoint convention.
 * aggregate is the bucket multiplier within that timeframe (e.g. timeframe="minute",
 * aggregate=15 -> 15-minute candles). limit is capped at 1000 by the real API. */
export async function getOhlcv(
  network: string,
  poolAddress: string,
  timeframe: "day" | "hour" | "minute" = "hour",
  options: { aggregate?: number; limit?: number } = {},
): Promise<OhlcvCandle[]> {
  try {
    const params = new URLSearchParams({ currency: "usd" });
    if (options.aggregate) params.set("aggregate", String(options.aggregate));
    if (options.limit) params.set("limit", String(options.limit));
    const data = await request(
      `/networks/${network}/pools/${poolAddress}/ohlcv/${timeframe}?${params.toString()}`,
      ohlcvResponseSchema,
    );
    return data.data.attributes.ohlcv_list.map(([timestamp, open, high, low, close, volume]) => ({
      timestamp,
      open,
      high,
      low,
      close,
      volume,
    }));
  } catch (err) {
    logClientFailure(SOURCE, err);
    return [];
  }
}

export async function getPoolInfo(network: string, poolAddress: string): Promise<PoolInfo | null> {
  try {
    const data = await request(`/networks/${network}/pools/${poolAddress}`, poolInfoResponseSchema);
    const attrs = data.data.attributes;
    return {
      priceUsd: attrs.base_token_price_usd ? Number(attrs.base_token_price_usd) : null,
      fdvUsd: attrs.fdv_usd ? Number(attrs.fdv_usd) : null,
      liquidityUsd: attrs.reserve_in_usd ? Number(attrs.reserve_in_usd) : null,
      volume24hUsd: attrs.volume_usd?.h24 ? Number(attrs.volume_usd.h24) : null,
    };
  } catch (err) {
    logClientFailure(SOURCE, err);
    return null;
  }
}

/**
 * Token-level lookup, works directly off a mint address (no pool address needed), including for
 * tokens still on a launchpad bonding curve. Verified live against a fresh, non-graduated
 * Pump.fun mint, returns price/fdv even with no traditional liquidity pool yet.
 */
export async function getTokenInfo(network: string, address: string): Promise<TokenInfo | null> {
  try {
    const data = await request(`/networks/${network}/tokens/${address}`, tokenInfoResponseSchema);
    const attrs = data.data.attributes;
    return {
      priceUsd: attrs.price_usd ? Number(attrs.price_usd) : null,
      fdvUsd: attrs.fdv_usd ? Number(attrs.fdv_usd) : null,
      liquidityUsd: attrs.total_reserve_in_usd ? Number(attrs.total_reserve_in_usd) : null,
      volume24hUsd: attrs.volume_usd?.h24 ? Number(attrs.volume_usd.h24) : null,
      marketCapUsd: attrs.market_cap_usd ? Number(attrs.market_cap_usd) : null,
      graduationPct: attrs.launchpad_details?.graduation_percentage ?? null,
      graduated: attrs.launchpad_details?.completed ?? null,
      symbol: attrs.symbol ?? null,
      name: attrs.name ?? null,
    };
  } catch (err) {
    logClientFailure(SOURCE, err);
    return null;
  }
}
