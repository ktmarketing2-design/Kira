import { Router } from "express";
import { gmgnApi } from "@ceronix/kira-shared";
import { redis } from "../lib/redis.js";

const router = Router();
const CACHE_TTL_SECONDS = 60;
const CACHE_KEY = "trending:ticker";

router.get("/ticker", async (_req, res) => {
  const cached = await redis.get(CACHE_KEY);
  if (cached) {
    res.json(JSON.parse(cached));
    return;
  }

  const tokens = await gmgnApi.getTrending(20);
  const payload = { tokens };
  await redis.set(CACHE_KEY, JSON.stringify(payload), "EX", CACHE_TTL_SECONDS);
  res.json(payload);
});

export default router;
