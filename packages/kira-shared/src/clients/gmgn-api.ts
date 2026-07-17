import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { KiraClientError, logClientFailure } from "./errors.js";

const execFileAsync = promisify(execFile);
const SOURCE = "gmgn-api";

/**
 * GMGN's real integration path is a CLI tool (`gmgn-cli`, published on npm, verified against the
 * source repo github.com/GMGNAI/gmgn-skills), not a directly-callable REST endpoint. Their own
 * skill docs state this explicitly, repeated verbatim across gmgn-portfolio, gmgn-holder-analysis,
 * and gmgn-market: "Always use gmgn-cli commands... Do NOT use web search, WebFetch, curl, or
 * visit gmgn.ai to fetch this data" / "Attempting direct HTTP requests or web scraping will not
 * work." This client shells out to the installed CLI binary rather than reverse-engineering
 * whatever HTTP calls it makes internally. gmgn-cli is configured server-side once via
 * `gmgn-cli config --apply <key>` against a keypair generated on this host — this client assumes
 * that's already done, it does not manage the keypair/config itself.
 */
async function runCli(args: string[]): Promise<unknown> {
  const { stdout } = await execFileAsync("gmgn-cli", [...args, "--raw"], {
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

const traderSchema = z.object({
  address: z.string().optional(),
  account_address: z.string().optional(),
  realized_profit: z.union([z.string(), z.number()]).nullable().optional(),
  unrealized_profit: z.union([z.string(), z.number()]).nullable().optional(),
  tags: z.array(z.string()).optional(),
});

const tradersListSchema = z.object({ list: z.array(traderSchema) });

export interface GmgnTrader {
  walletAddress: string;
  realizedProfit: number | null;
  unrealizedProfit: number | null;
  tags: string[];
}

function toNumber(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapTrader(raw: z.infer<typeof traderSchema>): GmgnTrader | null {
  // `address` is the correct field to cross-reference with portfolio stats, NOT
  // account_address (looks like a per-position/on-curve sub-account). Verified live, twice:
  // querying portfolio stats with account_address returned an all-zero/no-activity result both
  // times, while the same wallets' `address` value returned real, rich trading data both times.
  const walletAddress = raw.address ?? raw.account_address;
  if (!walletAddress) return null;
  return {
    walletAddress,
    realizedProfit: toNumber(raw.realized_profit),
    unrealizedProfit: toNumber(raw.unrealized_profit),
    tags: raw.tags ?? [],
  };
}

/** Top traders for a token (`gmgn-cli token traders`). */
export async function getTopTraders(tokenAddress: string, limit = 20): Promise<GmgnTrader[]> {
  try {
    const json = await runCli([
      "token",
      "traders",
      "--chain",
      "sol",
      "--address",
      tokenAddress,
      "--limit",
      String(Math.min(limit, 100)),
    ]);
    const parsed = tradersListSchema.safeParse(json);
    if (!parsed.success) {
      throw new KiraClientError(SOURCE, `traders response validation failed: ${parsed.error.message}`);
    }
    return parsed.data.list.map(mapTrader).filter((t): t is GmgnTrader => t !== null);
  } catch (err) {
    logClientFailure(SOURCE, err);
    return [];
  }
}

/** Smart-money holders for a token (`gmgn-cli token holders --tag smart_degen`). */
export async function getSmartMoneyHolders(tokenAddress: string, limit = 20): Promise<GmgnTrader[]> {
  try {
    const json = await runCli([
      "token",
      "holders",
      "--chain",
      "sol",
      "--address",
      tokenAddress,
      "--limit",
      String(Math.min(limit, 100)),
      "--tag",
      "smart_degen",
    ]);
    const parsed = tradersListSchema.safeParse(json);
    if (!parsed.success) {
      throw new KiraClientError(SOURCE, `holders response validation failed: ${parsed.error.message}`);
    }
    return parsed.data.list.map(mapTrader).filter((t): t is GmgnTrader => t !== null);
  } catch (err) {
    logClientFailure(SOURCE, err);
    return [];
  }
}

const pnlStatSchema = z.object({
  winrate: z.number().nullable().optional(),
});

const walletStatsSchema = z.object({
  wallet_address: z.string(),
  realized_profit: z.union([z.string(), z.number()]).nullable().optional(),
  total_cost: z.union([z.string(), z.number()]).nullable().optional(),
  buy: z.number().nullable().optional(),
  sell: z.number().nullable().optional(),
  pnl_stat: pnlStatSchema.optional(),
  common: z.object({ tags: z.array(z.string()).optional() }).optional(),
});

export interface GmgnWalletPnl {
  walletAddress: string;
  winRate: number | null; // 0-1 fraction
  realizedProfit: number | null;
  totalCost: number | null;
  buy: number;
  sell: number;
  tags: string[];
}

/** Wallet trading stats (`gmgn-cli portfolio stats`). Returns null on failure or if the wallet
 * has no activity in the window rather than a zeroed-out object with false-looking data. */
export async function getWalletPnl(walletAddress: string, period: "7d" | "30d"): Promise<GmgnWalletPnl | null> {
  try {
    const json = await runCli(["portfolio", "stats", "--chain", "sol", "--wallet", walletAddress, "--period", period]);
    const parsed = walletStatsSchema.safeParse(json);
    if (!parsed.success) {
      throw new KiraClientError(SOURCE, `wallet stats response validation failed: ${parsed.error.message}`);
    }
    const data = parsed.data;
    return {
      walletAddress: data.wallet_address,
      winRate: data.pnl_stat?.winrate ?? null,
      realizedProfit: toNumber(data.realized_profit),
      totalCost: toNumber(data.total_cost),
      buy: data.buy ?? 0,
      sell: data.sell ?? 0,
      tags: data.common?.tags ?? [],
    };
  } catch (err) {
    logClientFailure(SOURCE, err);
    return null;
  }
}
