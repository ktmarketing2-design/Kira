import { z } from "zod";
import { RateLimiter } from "./rateLimiter.js";
import { KiraClientError, logClientFailure } from "./errors.js";

const SOURCE = "pumpfun";
// The documented frontend-api.pump.fun domain is dead (Cloudflare error 1016, origin DNS
// failure, verified live). frontend-api-v3.pump.fun is the current live domain, same path shape.
const BASE_URL = "https://frontend-api-v3.pump.fun";

const limiter = new RateLimiter(30, 60_000);

const coinResponseSchema = z.object({
  mint: z.string(),
  name: z.string().optional(),
  symbol: z.string().optional(),
  market_cap: z.number().optional(),
  usd_market_cap: z.number().optional(),
  virtual_sol_reserves: z.number().optional(),
  virtual_token_reserves: z.number().optional(),
  complete: z.boolean().optional(), // true once graduated to PumpSwap/Raydium
  pump_swap_pool: z.string().nullable().optional(),
});

export interface PumpFunCoin {
  name: string | null;
  symbol: string | null;
  marketCapSol: number | null;
  usdMarketCap: number | null;
  virtualSolReserves: number | null;
  virtualTokenReserves: number | null;
  graduated: boolean;
  graduatedPoolAddress: string | null;
}

/** Bonding-curve coin info for a Pump.fun mint. Works pre- and post-graduation. */
export async function getCoinInfo(mintAddress: string): Promise<PumpFunCoin | null> {
  await limiter.acquire();
  try {
    const res = await fetch(`${BASE_URL}/coins/${mintAddress}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      throw new KiraClientError(SOURCE, `unexpected status ${res.status}`, { status: res.status });
    }
    const json = await res.json();
    const parsed = coinResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new KiraClientError(SOURCE, `response validation failed: ${parsed.error.message}`);
    }
    const data = parsed.data;
    return {
      name: data.name ?? null,
      symbol: data.symbol ?? null,
      marketCapSol: data.market_cap ?? null,
      usdMarketCap: data.usd_market_cap ?? null,
      virtualSolReserves: data.virtual_sol_reserves ?? null,
      virtualTokenReserves: data.virtual_token_reserves ?? null,
      graduated: data.complete ?? false,
      graduatedPoolAddress: data.pump_swap_pool ?? null,
    };
  } catch (err) {
    logClientFailure(SOURCE, err);
    return null;
  }
}
