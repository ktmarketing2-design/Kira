import { z } from "zod";
import { RateLimiter } from "./rateLimiter.js";
import { KiraClientError, logClientFailure } from "./errors.js";

const SOURCE = "helius";
const RPC_URL = "https://mainnet.helius-rpc.com";
// The legacy api.helius.xyz/v0 REST domain is dead (verified live: every v0 endpoint returns a
// Cloudflare 403 challenge page regardless of path or method). The same v0 REST surface
// (enhanced transactions, webhooks) is live on the RPC domain instead, verified directly.
const BASE_URL = "https://mainnet.helius-rpc.com/v0";

// 50 req/s was too optimistic, live testing showed sustained 429s under normal DD-card load
// (roughly 2 Helius calls per sampled wallet, run in parallel). 10 req/s is conservative
// headroom under whatever the actual plan limit is; wallet-age caching and a smaller sample
// size (see kira-workers/volumeWorker.ts) cut the real request volume further.
const limiter = new RateLimiter(10, 1_000);

export interface HeliusConfig {
  apiKey: string;
}

const largestAccountsRpcSchema = z.object({
  result: z.object({
    value: z.array(
      z.object({
        address: z.string(),
        amount: z.string(),
        uiAmount: z.number().nullable(),
      }),
    ),
  }),
});

export interface TokenHolder {
  address: string;
  amount: string;
  uiAmount: number | null;
}

/** Top N holders (by raw token account balance, not owner-deduplicated) for a mint. */
export async function getTokenLargestAccounts(
  config: HeliusConfig,
  mintAddress: string,
): Promise<TokenHolder[]> {
  await limiter.acquire();
  try {
    const res = await fetch(`${RPC_URL}/?api-key=${config.apiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "kira-largest-accounts",
        method: "getTokenLargestAccounts",
        params: [mintAddress],
      }),
    });
    if (!res.ok) {
      throw new KiraClientError(SOURCE, `unexpected status ${res.status}`, { status: res.status });
    }
    const json = await res.json();
    if (json && typeof json === "object" && "error" in json) {
      // Solana/Helius RPC errors come back as 200 with an `error` field, not an HTTP error status
      // (e.g. mega-holder-count tokens like USDC can be refused, or transient index overload).
      throw new KiraClientError(SOURCE, `RPC error: ${JSON.stringify((json as { error: unknown }).error)}`);
    }
    const parsed = largestAccountsRpcSchema.safeParse(json);
    if (!parsed.success) {
      throw new KiraClientError(SOURCE, `response validation failed: ${parsed.error.message}`);
    }
    return parsed.data.result.value;
  } catch (err) {
    logClientFailure(SOURCE, err);
    return [];
  }
}

const parsedTransactionSchema = z.object({
  signature: z.string(),
  timestamp: z.number(),
  type: z.string().optional(),
  source: z.string().optional(),
  tokenTransfers: z
    .array(
      z.object({
        fromUserAccount: z.string().optional(),
        toUserAccount: z.string().optional(),
        mint: z.string().optional(),
        tokenAmount: z.number().optional(),
      }),
    )
    .optional(),
  nativeTransfers: z
    .array(
      z.object({
        fromUserAccount: z.string().optional(),
        toUserAccount: z.string().optional(),
        amount: z.number().optional(),
      }),
    )
    .optional(),
});

export type ParsedTransaction = z.infer<typeof parsedTransactionSchema>;

export interface TransactionHistoryOptions {
  limit?: number;
  before?: string;
  type?: string;
}

const signaturesRpcSchema = z.object({
  result: z.array(z.object({ signature: z.string() })),
});

// Verified live: the enhanced parse-by-signature endpoint rejects batches over 100 with a 400
// ("number of transactions cannot exceed 100").
const MAX_PARSE_BATCH = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Parsed transaction history for an address (wallet or program), newest first.
 *
 * There is no more direct "get enhanced history for an address" endpoint (the old
 * GET /v0/addresses/:address/transactions is on the dead api.helius.xyz domain and does not
 * exist elsewhere). This is now a two-step call: get recent signatures via the standard RPC
 * method, then POST them (batched at 100 per request) to the enhanced parse-by-signature
 * endpoint.
 */
export async function getTransactionHistory(
  config: HeliusConfig,
  address: string,
  options: TransactionHistoryOptions = {},
): Promise<ParsedTransaction[]> {
  await limiter.acquire();
  try {
    const sigRes = await fetch(`${RPC_URL}/?api-key=${config.apiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "kira-signatures",
        method: "getSignaturesForAddress",
        params: [address, { limit: options.limit ?? 100, before: options.before }],
      }),
    });
    if (!sigRes.ok) {
      throw new KiraClientError(SOURCE, `unexpected status ${sigRes.status}`, { status: sigRes.status });
    }
    const sigJson = await sigRes.json();
    const sigParsed = signaturesRpcSchema.safeParse(sigJson);
    if (!sigParsed.success) {
      throw new KiraClientError(SOURCE, `signatures response validation failed: ${sigParsed.error.message}`);
    }
    const signatures = sigParsed.data.result.map((r) => r.signature);
    if (signatures.length === 0) return [];

    const batches = chunk(signatures, MAX_PARSE_BATCH);
    const results: ParsedTransaction[] = [];
    for (const batch of batches) {
      await limiter.acquire();
      const parseRes = await fetch(`${BASE_URL}/transactions?api-key=${config.apiKey}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transactions: batch }),
      });
      if (!parseRes.ok) {
        throw new KiraClientError(SOURCE, `unexpected status ${parseRes.status}`, { status: parseRes.status });
      }
      const parseJson = await parseRes.json();
      const parsed = z.array(parsedTransactionSchema).safeParse(parseJson);
      if (!parsed.success) {
        throw new KiraClientError(SOURCE, `response validation failed: ${parsed.error.message}`);
      }
      results.push(...parsed.data);
    }
    return results;
  } catch (err) {
    logClientFailure(SOURCE, err);
    return [];
  }
}

const webhookSchema = z.object({
  webhookID: z.string(),
  wallet: z.string().optional(),
  webhookURL: z.string(),
  transactionTypes: z.array(z.string()),
  accountAddresses: z.array(z.string()).optional(),
  webhookType: z.string().optional(),
});

export type HeliusWebhook = z.infer<typeof webhookSchema>;

/**
 * Creates the single enhanced SWAP webhook for the given address set if none exists yet,
 * otherwise this should not be called again, use updateWebhookAddresses instead.
 */
export async function registerWebhook(
  config: HeliusConfig,
  addresses: string[],
  webhookUrl: string,
  secret: string,
): Promise<HeliusWebhook | null> {
  try {
    const res = await fetch(`${BASE_URL}/webhooks?api-key=${config.apiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        webhookURL: webhookUrl,
        transactionTypes: ["SWAP"],
        accountAddresses: addresses,
        webhookType: "enhanced",
        authHeader: secret,
      }),
    });
    if (!res.ok) {
      throw new KiraClientError(SOURCE, `unexpected status ${res.status}`, { status: res.status });
    }
    const json = await res.json();
    const parsed = webhookSchema.safeParse(json);
    if (!parsed.success) {
      throw new KiraClientError(SOURCE, `response validation failed: ${parsed.error.message}`);
    }
    return parsed.data;
  } catch (err) {
    logClientFailure(SOURCE, err);
    return null;
  }
}

/** Lists existing webhooks, used to find the one Kira owns before deciding create vs patch. */
export async function listWebhooks(config: HeliusConfig): Promise<HeliusWebhook[]> {
  try {
    const res = await fetch(`${BASE_URL}/webhooks?api-key=${config.apiKey}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      throw new KiraClientError(SOURCE, `unexpected status ${res.status}`, { status: res.status });
    }
    const json = await res.json();
    const parsed = z.array(webhookSchema).safeParse(json);
    if (!parsed.success) {
      throw new KiraClientError(SOURCE, `response validation failed: ${parsed.error.message}`);
    }
    return parsed.data;
  } catch (err) {
    logClientFailure(SOURCE, err);
    return [];
  }
}

/** PATCH the address list on an existing webhook, e.g. the whole watched-address union. */
export async function updateWebhookAddresses(
  config: HeliusConfig,
  webhookId: string,
  addresses: string[],
): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/webhooks/${webhookId}?api-key=${config.apiKey}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountAddresses: addresses }),
    });
    if (!res.ok) {
      throw new KiraClientError(SOURCE, `unexpected status ${res.status}`, { status: res.status });
    }
    return true;
  } catch (err) {
    logClientFailure(SOURCE, err);
    return false;
  }
}
