import { z } from "zod";
import { RateLimiter } from "./rateLimiter.js";
import { KiraClientError, logClientFailure } from "./errors.js";

const SOURCE = "jupiter";
// price.jup.ag/v6 and api.jup.ag/price/v2 are both retired, api.jup.ag/price/v3 is current
// (verified live against the API directly, response shape changed too: usdPrice is a number,
// not the old data.{mint}.price string).
const BASE_URL = "https://api.jup.ag/price/v3";

const limiter = new RateLimiter(120, 60_000);

const priceResponseSchema = z.record(
  z.string(),
  z.object({
    usdPrice: z.number(),
    decimals: z.number().optional(),
    blockId: z.number().optional(),
    priceChange24h: z.number().optional(),
  }),
);

/** Live USD price for one mint, or null if not found / on failure. */
export async function getPrice(mintAddress: string): Promise<number | null> {
  await limiter.acquire();
  try {
    const res = await fetch(`${BASE_URL}?ids=${mintAddress}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      throw new KiraClientError(SOURCE, `unexpected status ${res.status}`, { status: res.status });
    }
    const json = await res.json();
    const parsed = priceResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new KiraClientError(SOURCE, `response validation failed: ${parsed.error.message}`);
    }
    const entry = parsed.data[mintAddress];
    return entry ? entry.usdPrice : null;
  } catch (err) {
    logClientFailure(SOURCE, err);
    return null;
  }
}

/** Batched price lookup, one request for up to 100 mints. */
export async function getPrices(mintAddresses: string[]): Promise<Record<string, number>> {
  if (mintAddresses.length === 0) return {};
  await limiter.acquire();
  try {
    const res = await fetch(`${BASE_URL}?ids=${mintAddresses.join(",")}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      throw new KiraClientError(SOURCE, `unexpected status ${res.status}`, { status: res.status });
    }
    const json = await res.json();
    const parsed = priceResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new KiraClientError(SOURCE, `response validation failed: ${parsed.error.message}`);
    }
    const out: Record<string, number> = {};
    for (const [mint, entry] of Object.entries(parsed.data)) {
      out[mint] = entry.usdPrice;
    }
    return out;
  } catch (err) {
    logClientFailure(SOURCE, err);
    return {};
  }
}
