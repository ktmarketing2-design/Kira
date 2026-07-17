import { Router } from "express";
import { gmgnApi } from "@ceronix/kira-shared";
import { redis } from "../lib/redis.js";

const router = Router();
const CACHE_TTL_SECONDS = 60;

const VALID_TYPES = new Set(["new_creation", "near_completion", "completed"]);
// Trenches' response envelope always has all three bucket keys, but near_completion's actual
// list lands under "pump" not "near_completion" -- see gmgn-api.ts's getTrenches comment.
const BUCKET_KEY: Record<string, string> = {
  new_creation: "new_creation",
  near_completion: "pump",
  completed: "completed",
};

interface RawTrenchToken {
  address?: string;
  name?: string;
  symbol?: string;
  logo?: string;
  market_cap?: number;
  usd_market_cap?: number;
  liquidity?: number;
  holder_count?: number;
  top_10_holder_rate?: number;
  smart_degen_count?: number;
  renowned_count?: number;
  sniper_count?: number;
  rug_ratio?: number;
  is_honeypot?: boolean | string;
  renounced_mint?: boolean;
  renounced_freeze_account?: boolean;
  rat_trader_amount_rate?: number;
  bundler_rate?: number;
  bundler_trader_amount_rate?: number;
  fresh_wallet_rate?: number;
  dev_team_hold_rate?: number;
  creator?: string;
  launchpad?: string;
  launchpad_platform?: string;
  created_timestamp?: number;
  open_timestamp?: number;
  is_wash_trading?: boolean;
  exchange?: string;
}

router.get("/", async (req, res) => {
  const type = String(req.query.type || "new_creation");
  if (!VALID_TYPES.has(type)) {
    res.status(400).json({ error: "type must be one of new_creation, near_completion, completed" });
    return;
  }

  const cacheKey = `discover:${type}`;
  const cached = await redis.get(cacheKey);
  if (cached) {
    res.json(JSON.parse(cached));
    return;
  }

  const json = await gmgnApi.getTrenches(type as gmgnApi.TrenchType);
  const list = (json[BUCKET_KEY[type]] as RawTrenchToken[] | undefined) ?? [];

  const tokens = list.map((t) => ({
    address: t.address,
    name: t.name,
    symbol: t.symbol,
    logo: t.logo,
    marketCap: t.usd_market_cap ?? t.market_cap ?? null,
    liquidity: t.liquidity ?? null,
    holderCount: t.holder_count ?? null,
    top10HolderRate: t.top_10_holder_rate ?? null,
    smartDegenCount: t.smart_degen_count ?? 0,
    renownedCount: t.renowned_count ?? 0,
    sniperCount: t.sniper_count ?? 0,
    rugRatio: t.rug_ratio ?? null,
    isHoneypot: t.is_honeypot === true || t.is_honeypot === "yes",
    renouncedMint: t.renounced_mint ?? null,
    renouncedFreeze: t.renounced_freeze_account ?? null,
    ratTraderRate: t.rat_trader_amount_rate ?? null,
    bundlerRate: t.bundler_rate ?? t.bundler_trader_amount_rate ?? null,
    freshWalletRate: t.fresh_wallet_rate ?? null,
    devHoldRate: t.dev_team_hold_rate ?? null,
    creatorAddress: t.creator ?? null,
    launchpad: t.launchpad ?? t.launchpad_platform ?? null,
    createdAt: t.created_timestamp ?? null,
    openAt: t.open_timestamp ?? null,
    isWashTrading: t.is_wash_trading ?? false,
    exchange: t.exchange ?? null,
  }));

  const payload = { tokens, type, updatedAt: Date.now() };
  await redis.set(cacheKey, JSON.stringify(payload), "EX", CACHE_TTL_SECONDS);
  res.json(payload);
});

export default router;
