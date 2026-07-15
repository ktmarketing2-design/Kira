import { z } from "zod";
import { RateLimiter } from "./rateLimiter.js";
import { KiraClientError, logClientFailure } from "./errors.js";

const SOURCE = "bags";
const BASE_URL = "https://api.bags.fm/api/v1";

const limiter = new RateLimiter(30, 60_000);

const coinResponseSchema = z.object({
  name: z.string().optional(),
  symbol: z.string().optional(),
  marketCap: z.number().optional(),
  graduated: z.boolean().optional(),
});

export interface BagsCoin {
  name: string | null;
  symbol: string | null;
  marketCap: number | null;
  graduated: boolean;
}

/**
 * UNVERIFIED endpoint. api.bags.fm is a real backend (confirmed live, returns proper 404s rather
 * than an SPA shell), but no public token-lookup path could be confirmed from this environment,
 * every guessed path 404s. Kept as a best-effort call: on any failure (404, wrong shape, etc.)
 * this returns null and the caller (ddWorker) falls through to GeckoTerminal next, which is the
 * explicit behavior asked for. Replace the path below if/when the real one is confirmed.
 */
export async function getCoinInfo(mintAddress: string): Promise<BagsCoin | null> {
  await limiter.acquire();
  try {
    const res = await fetch(`${BASE_URL}/token-launch/${mintAddress}`, {
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
