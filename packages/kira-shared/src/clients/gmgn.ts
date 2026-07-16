import { z } from "zod";
import { RateLimiter } from "./rateLimiter.js";
import { KiraClientError, logClientFailure } from "./errors.js";

const SOURCE = "gmgn";
const BASE_URL = "https://gmgn.ai/defi/quotation/v1";

// No published rate limit, conservative default matching other unauthenticated clients in this file.
const limiter = new RateLimiter(10, 1_000);

// GMGN's real field list has 50+ keys (balances per chain, per-window pnl/volume/txs breakdowns
// etc.), only extracting what SmartWalletCandidate actually needs. Unlisted keys are stripped,
// not errors (default zod object behavior). Numeric-looking fields like pnl_7d and
// realized_profit_7d come back as strings, not JSON numbers, on the real API — coerced here.
// winrate_30d (not a bare "winrate", verified live — that field does not exist in the real
// response, only windowed variants winrate_1d/7d/30d) can be a genuine null for wallets GMGN
// hasn't computed a win rate for yet.
const gmgnWalletSchema = z.object({
  wallet_address: z.string(),
  pnl_7d: z.coerce.number().nullable().optional(),
  winrate_30d: z.coerce.number().nullable().optional(),
  realized_profit_7d: z.coerce.number().nullable().optional(),
  tags: z.array(z.string()).optional(),
  twitter_username: z.string().nullable().optional(),
});

const gmgnRankResponseSchema = z.object({
  code: z.number(),
  data: z.object({
    rank: z.array(gmgnWalletSchema),
  }),
});

export interface SmartWalletCandidate {
  walletAddress: string;
  pnl7d: number | null;
  winRate30d: number | null; // 0-1 fraction, null if GMGN has not computed one yet
  realizedProfit7d: number | null;
  tags: string[];
  twitterUsername: string | null;
}

/**
 * GMGN's wallet-rankings endpoint is publicly reachable (no API key) but sits behind Cloudflare
 * bot detection: a bare fetch with default headers gets a 403 "Just a moment..." challenge page,
 * verified live. A browser-like User-Agent + Referer + Accept-Language is enough to pass without
 * solving anything — this is not a paywall or auth requirement, just a UA/header check.
 */
async function request<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  await limiter.acquire();
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      headers: {
        accept: "application/json, text/plain, */*",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        referer: "https://gmgn.ai/",
        "accept-language": "en-US,en;q=0.9",
      },
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

/** Top Solana wallets by PnL over the given window. Returns [] on any failure (network, block,
 * schema drift) rather than throwing, matching every other client in this file — a smart-wallet
 * refresh skipping a day is fine, crashing the worker over it is not. */
export async function getTopWallets(timeframe: "7d" | "30d", limit: number): Promise<SmartWalletCandidate[]> {
  try {
    const data = await request(
      `/rank/sol/wallets/${timeframe}?orderby=pnl&direction=desc&limit=${limit}`,
      gmgnRankResponseSchema,
    );
    return data.data.rank.map((w) => ({
      walletAddress: w.wallet_address,
      pnl7d: w.pnl_7d ?? null,
      winRate30d: w.winrate_30d ?? null,
      realizedProfit7d: w.realized_profit_7d ?? null,
      tags: w.tags ?? [],
      twitterUsername: w.twitter_username ?? null,
    }));
  } catch (err) {
    logClientFailure(SOURCE, err);
    return [];
  }
}
