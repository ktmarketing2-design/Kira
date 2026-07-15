import { z } from "zod";
import { RateLimiter } from "./rateLimiter.js";
import { KiraClientError, logClientFailure } from "./errors.js";

const SOURCE = "goplus";
const BASE_URL = "https://api.gopluslabs.io/api/v1";

const limiter = new RateLimiter(30, 60_000);

// GoPlus returns stringified booleans/numbers ("1"/"0") in a keyed-by-address map.
const tokenSecurityEntrySchema = z.object({
  is_honeypot: z.string().optional(),
  buy_tax: z.string().optional(),
  sell_tax: z.string().optional(),
  is_mintable: z.string().optional(),
  owner_address: z.string().optional(),
  lp_holders: z
    .array(
      z.object({
        address: z.string().optional(),
        percent: z.string().optional(),
        is_locked: z.number().optional(),
      }),
    )
    .optional(),
});

const responseSchema = z.object({
  code: z.number().optional(),
  // GoPlus returns result: null (not an empty object) when it has no data for the address,
  // observed live for an address with no findings on the Solana chain id.
  result: z.record(z.string(), tokenSecurityEntrySchema).nullable().optional(),
});

export interface TokenSecurity {
  isHoneypot: boolean;
  buyTaxPct: number | null;
  sellTaxPct: number | null;
  isMintable: boolean;
  ownerAddress: string | null;
  lpHolderCount: number;
}

/** chainId: GoPlus chain id string, e.g. "solana" for Solana per their multi-chain API. */
export async function getTokenSecurity(chainId: string, address: string): Promise<TokenSecurity | null> {
  await limiter.acquire();
  try {
    const res = await fetch(
      `${BASE_URL}/token_security/${chainId}?contract_addresses=${address}`,
      { headers: { accept: "application/json" } },
    );
    if (!res.ok) {
      throw new KiraClientError(SOURCE, `unexpected status ${res.status}`, { status: res.status });
    }
    const json = await res.json();
    const parsed = responseSchema.safeParse(json);
    if (!parsed.success) {
      throw new KiraClientError(SOURCE, `response validation failed: ${parsed.error.message}`);
    }
    const entry = parsed.data.result?.[address.toLowerCase()] ?? parsed.data.result?.[address];
    if (!entry) return null;

    return {
      isHoneypot: entry.is_honeypot === "1",
      buyTaxPct: entry.buy_tax ? Number(entry.buy_tax) * 100 : null,
      sellTaxPct: entry.sell_tax ? Number(entry.sell_tax) * 100 : null,
      isMintable: entry.is_mintable === "1",
      ownerAddress: entry.owner_address || null,
      lpHolderCount: entry.lp_holders?.length ?? 0,
    };
  } catch (err) {
    logClientFailure(SOURCE, err);
    return null;
  }
}
