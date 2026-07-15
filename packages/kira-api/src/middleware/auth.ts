import type { NextFunction, Request, Response } from "express";
import { supabase } from "../lib/supabase.js";

/**
 * Trust secret for kira-bot -> kira-api calls. Both processes run on the same box and already
 * share TELEGRAM_BOT_TOKEN via the same .env, there is no dedicated internal-service secret
 * provisioned for Kira, so this reuses that value rather than requiring a new env var. The bot
 * never exposes this to end users, it only ever appears in server-to-server localhost calls.
 */
const BOT_INTERNAL_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

async function authenticateViaBotHeader(req: Request): Promise<{ id: string } | null> {
  const botToken = req.headers["x-kira-bot-token"];
  const telegramUserId = req.headers["x-telegram-user-id"];

  if (!BOT_INTERNAL_TOKEN || botToken !== BOT_INTERNAL_TOKEN || !telegramUserId) {
    return null;
  }

  const { data, error } = await supabase
    .from("kira_profiles")
    .select("id")
    .eq("telegram_user_id", Number(telegramUserId))
    .maybeSingle();

  if (error || !data) return null;
  return { id: data.id };
}

/**
 * Verifies either a Supabase JWT (web) or the internal bot header (kira-bot on localhost) and
 * attaches req.user. The JWT path mirrors apps/api/src/middleware/auth.ts.
 */
export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const viaBotHeader = await authenticateViaBotHeader(req);
    if (viaBotHeader) {
      req.user = viaBotHeader;
      next();
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing or malformed authorization header" });
      return;
    }

    const token = authHeader.slice("Bearer ".length);
    if (!token) {
      res.status(401).json({ error: "Missing token" });
      return;
    }

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }

    req.user = { id: user.id, email: user.email ?? undefined };
    next();
  } catch (err) {
    console.error("[kira-api:auth] unexpected error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Internal server error during authentication" });
  }
}
