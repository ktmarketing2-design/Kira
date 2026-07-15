import { GoogleGenAI } from "@google/genai";
import { redis } from "./redis.js";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  throw new Error("GEMINI_API_KEY must be set in the environment");
}

const ai = new GoogleGenAI({ apiKey });
const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

// Rough per-module daily token ceilings. Tune once real usage data exists (Architecture doc
// Section 7: "hard budgets... if the KOL classifier hits its cap, it queues instead of spending").
const DAILY_TOKEN_BUDGET: Record<string, number> = {
  dd: 200_000,
  "kol-classify": 100_000,
};

function budgetKey(module: string): string {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `budget:gemini:${module}:${today}`;
}

function secondsUntilMidnightUtc(): number {
  const now = new Date();
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.ceil((midnight - now.getTime()) / 1000);
}

/** Reserves estimated tokens against the module's daily budget. Returns false if it would exceed the cap. */
export async function reserveGeminiBudget(module: string, estimatedTokens: number): Promise<boolean> {
  const cap = DAILY_TOKEN_BUDGET[module] ?? 50_000;
  const key = budgetKey(module);

  const used = await redis.incrby(key, estimatedTokens);
  if (used === estimatedTokens) {
    // First write of the day for this module, set the daily expiry.
    await redis.expire(key, secondsUntilMidnightUtc());
  }

  if (used > cap) {
    // Refund the reservation, this call is not going to happen.
    await redis.decrby(key, estimatedTokens);
    return false;
  }
  return true;
}

/** Generates one short completion. Caller must reserve budget first via reserveGeminiBudget. */
export async function generateText(prompt: string, model = DEFAULT_MODEL): Promise<string | null> {
  try {
    const response = await ai.models.generateContent({ model, contents: prompt });
    return response.text ?? null;
  } catch (err) {
    console.error("[kira-workers:gemini] generation failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
