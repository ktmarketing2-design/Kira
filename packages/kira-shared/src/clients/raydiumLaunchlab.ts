import { z } from "zod";
import { RateLimiter } from "./rateLimiter.js";
import { KiraClientError, logClientFailure } from "./errors.js";
import { getTokenInfo as getGeckoTerminalTokenInfo } from "./geckoterminal.js";

const SOURCE = "raydium-launchlab";
// Verified live: api-v3.raydium.io/pools/info/mint. Covers both regular Raydium pools and
// LaunchLab pools (LaunchLab is Raydium's own launchpad product, same pool API surface).
const BASE_URL = "https://api-v3.raydium.io";

const limiter = new RateLimiter(30, 60_000);

const poolsResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    data: z.array(
      z.object({
        tvl: z.number().optional(),
        price: z.number().optional(),
        day: z.object({ volume: z.number().optional() }).optional(),
      }),
    ),
  }),
});

export interface PoolInfo {
  priceUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
}

/**
 * Pool info for a mint via Raydium's own pools-by-mint API, falls back to GeckoTerminal's
 * token lookup if Raydium has no pool for this mint (e.g. a LaunchLab token still pre-migration,
 * which uses a bonding-curve program rather than a standard AMM pool).
 */
export async function getPoolInfo(mintAddress: string): Promise<PoolInfo | null> {
  await limiter.acquire();
  try {
    const res = await fetch(
      `${BASE_URL}/pools/info/mint?mint1=${mintAddress}&poolType=all&poolSortField=default&sortType=desc&pageSize=1&page=1`,
      { headers: { accept: "application/json" } },
    );
    if (!res.ok) {
      throw new KiraClientError(SOURCE, `unexpected status ${res.status}`, { status: res.status });
    }
    const json = await res.json();
    const parsed = poolsResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new KiraClientError(SOURCE, `response validation failed: ${parsed.error.message}`);
    }
    const pool = parsed.data.data.data[0];
    if (!pool) return getGeckoTerminalFallback(mintAddress);

    return {
      priceUsd: pool.price ?? null,
      liquidityUsd: pool.tvl ?? null,
      volume24hUsd: pool.day?.volume ?? null,
    };
  } catch (err) {
    logClientFailure(SOURCE, err);
    return getGeckoTerminalFallback(mintAddress);
  }
}

async function getGeckoTerminalFallback(mintAddress: string): Promise<PoolInfo | null> {
  const info = await getGeckoTerminalTokenInfo("solana", mintAddress);
  if (!info) return null;
  return { priceUsd: info.priceUsd, liquidityUsd: info.liquidityUsd, volume24hUsd: info.volume24hUsd };
}
