import { z } from "zod";
import { RateLimiter } from "./rateLimiter.js";
import { KiraClientError, logClientFailure } from "./errors.js";

const SOURCE = "birdeye";
const BASE_URL = "https://public-api.birdeye.so";

// No published rate limit for this endpoint, conservative default matching other clients in this file.
const limiter = new RateLimiter(10, 1_000);

const birdeyeTraderSchema = z.object({
  address: z.string(),
  pnl: z.number().nullable().optional(),
  realized_pnl: z.number().nullable().optional(),
});

const birdeyeResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    items: z.array(birdeyeTraderSchema),
  }),
});

export interface BirdeyeWallet {
  wallet_address: string;
  pnl_7d: number;
  winrate?: number;
  realized_profit?: number;
  tags?: string[];
}

/**
 * Two candidate endpoints were tried live before picking this one:
 * - GET /v1/wallet/list_of_address -> 401 "API key lacks sufficient permissions", not usable
 *   on the current key's plan.
 * - GET /trader/gainers-losers -> works, but only with type=1W/30d/90d/yesterday/today, NOT
 *   "7D" as originally assumed (verified live: "7D" returns a 400 with the valid-values list
 *   in the error message). type=1W is the closest available window to "7 days".
 * The real response has no winrate or tags field at all, only address/pnl/realized_pnl/
 * unrealized_pnl/volume/trade_count/network — winrate and tags on BirdeyeWallet are always
 * undefined from this endpoint, kept optional in the type for a future endpoint that has them.
 */
async function request<T>(path: string, apiKey: string, schema: z.ZodType<T>): Promise<T> {
  await limiter.acquire();
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      headers: { "X-API-KEY": apiKey, accept: "application/json" },
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

/** Top Solana wallets by 7d-ish PnL (Birdeye's closest window is type=1W). Returns [] on any
 * failure rather than throwing, matching every other client in this file. */
export async function getTopWallets(apiKey: string, limit: number): Promise<BirdeyeWallet[]> {
  try {
    const data = await request(
      `/trader/gainers-losers?type=1W&sort_by=PnL&sort_type=desc&offset=0&limit=${limit}&chain=solana`,
      apiKey,
      birdeyeResponseSchema,
    );
    return data.data.items.map((w) => ({
      wallet_address: w.address,
      pnl_7d: w.pnl ?? 0,
      realized_profit: w.realized_pnl ?? undefined,
    }));
  } catch (err) {
    logClientFailure(SOURCE, err);
    return [];
  }
}
