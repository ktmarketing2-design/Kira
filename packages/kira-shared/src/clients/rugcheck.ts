import { z } from "zod";
import { RateLimiter } from "./rateLimiter.js";
import { KiraClientError, logClientFailure } from "./errors.js";

const SOURCE = "rugcheck";
const BASE_URL = "https://api.rugcheck.xyz/v1";

const limiter = new RateLimiter(60, 60_000);

const riskSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  level: z.string().optional(),
  score: z.number().optional(),
});

// Verified live against the real API: the actual mint/freeze authority pubkeys live under
// `token.*`. Top-level `mintAuthority` / `freezeAuthority` keys also exist in the real response,
// but they are raw account-info blobs (lamports/owner/data/...) for those addresses, not the
// pubkeys themselves, they are intentionally not declared here so Zod ignores them instead of
// failing validation against the wrong shape. `topHolders` and `markets` can both be null.
const tokenReportResponseSchema = z.object({
  score: z.number().optional(),
  mint: z.string().optional(),
  creator: z.string().optional(),
  token: z
    .object({
      mintAuthority: z.string().nullable().optional(),
      freezeAuthority: z.string().nullable().optional(),
    })
    .optional(),
  risks: z.array(riskSchema).optional(),
  // lp.lpLocked is a raw LP-token amount (number), not a boolean, "percent locked" is the
  // separate lpLockedPct field, verified live (BONK: lpLocked: 0, lpLockedPct: 0 across pools).
  markets: z
    .array(
      z.object({
        lp: z
          .object({
            lpLocked: z.number().optional(),
            lpLockedPct: z.number().optional(),
          })
          .optional(),
      }),
    )
    .nullable()
    .optional(),
  topHolders: z
    .array(
      z.object({
        address: z.string(),
        pct: z.number().optional(),
      }),
    )
    .nullable()
    .optional(),
  tokenMeta: z
    .object({
      name: z.string().optional(),
      symbol: z.string().optional(),
    })
    .optional(),
});

export interface TokenReport {
  score: number | null;
  deployerAddress: string | null;
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
  lpLocked: boolean;
  top10HolderPct: number | null;
  risks: Array<{ name: string; level?: string }>;
  symbol: string | null;
  name: string | null;
}

export async function getTokenReport(mintAddress: string): Promise<TokenReport | null> {
  await limiter.acquire();
  try {
    const res = await fetch(`${BASE_URL}/tokens/${mintAddress}/report`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      throw new KiraClientError(SOURCE, `unexpected status ${res.status}`, { status: res.status });
    }
    const json = await res.json();
    const parsed = tokenReportResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new KiraClientError(SOURCE, `response validation failed: ${parsed.error.message}`);
    }
    const data = parsed.data;
    const topHolders = data.topHolders ?? [];
    const top10Pct = topHolders.slice(0, 10).reduce((sum, h) => sum + (h.pct ?? 0), 0);
    const markets = data.markets ?? [];

    return {
      score: data.score ?? null,
      deployerAddress: data.creator ?? null,
      mintAuthorityRevoked: (data.token?.mintAuthority ?? null) == null,
      freezeAuthorityRevoked: (data.token?.freezeAuthority ?? null) == null,
      lpLocked: markets.some((m) => (m.lp?.lpLockedPct ?? 0) > 0),
      top10HolderPct: topHolders.length > 0 ? top10Pct : null,
      risks: (data.risks ?? []).map((r) => ({ name: r.name, level: r.level })),
      symbol: data.tokenMeta?.symbol ?? null,
      name: data.tokenMeta?.name ?? null,
    };
  } catch (err) {
    logClientFailure(SOURCE, err);
    return null;
  }
}
