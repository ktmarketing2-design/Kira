import { z } from "zod";
import { RateLimiter } from "./rateLimiter.js";
import { KiraClientError, logClientFailure } from "./errors.js";

const SOURCE = "letsbonk";
const BASE_URL = "https://letsbonk.fun/api";

const limiter = new RateLimiter(30, 60_000);

const coinResponseSchema = z.object({
  name: z.string().optional(),
  symbol: z.string().optional(),
  marketCap: z.number().optional(),
  graduated: z.boolean().optional(),
});

export interface LetsBonkCoin {
  name: string | null;
  symbol: string | null;
  marketCap: number | null;
  graduated: boolean;
}

/**
 * UNVERIFIED endpoint. letsbonk.fun (BONKfun) is a client-side-routed SPA, every path under
 * letsbonk.fun/api/* returns the same index.html shell rather than JSON, its real backend API
 * host could not be found by inspection from this environment. This call is expected to fail
 * and return null in practice today, that is by design: the caller (ddWorker) falls through to
 * GeckoTerminal next, which does index LetsBonk/Raydium LaunchLab tokens generically. Replace
 * BASE_URL if/when the real API host is confirmed.
 */
export async function getCoinInfo(mintAddress: string): Promise<LetsBonkCoin | null> {
  await limiter.acquire();
  try {
    const res = await fetch(`${BASE_URL}/coins/${mintAddress}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      throw new KiraClientError(SOURCE, `unexpected status ${res.status}`, { status: res.status });
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      throw new KiraClientError(SOURCE, `non-JSON response (content-type: ${contentType})`);
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
      marketCap: data.marketCap ?? null,
      graduated: data.graduated ?? false,
    };
  } catch (err) {
    logClientFailure(SOURCE, err);
    return null;
  }
}
