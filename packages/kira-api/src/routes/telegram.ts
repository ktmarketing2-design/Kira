import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";

const router = Router();

const BOT_INTERNAL_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const LINK_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I ambiguity

function requireBotToken(req: Request, res: Response): boolean {
  const token = req.headers["x-kira-bot-token"];
  if (!BOT_INTERNAL_TOKEN || token !== BOT_INTERNAL_TOKEN) {
    res.status(401).json({ error: "Invalid internal token" });
    return false;
  }
  return true;
}

function generateLinkCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += LINK_CODE_ALPHABET[crypto.randomInt(LINK_CODE_ALPHABET.length)];
  }
  return code;
}

const startSchema = z.object({
  telegramUserId: z.number().int(),
  telegramUsername: z.string().optional(),
});

/**
 * Bot-only bootstrap for /start. Not behind authMiddleware, there is no Supabase user yet for a
 * telegram-only visitor, gated instead by the same internal bot-token header used elsewhere.
 * Creates a shadow auth.users row via the admin API so kira_profiles' FK to auth.users(id) is
 * satisfiable before the visitor ever signs in on the web.
 */
router.post("/start", async (req, res) => {
  if (!requireBotToken(req, res)) return;

  const parsed = startSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }
  const { telegramUserId, telegramUsername } = parsed.data;

  const { data: existing, error: lookupError } = await supabase
    .from("kira_profiles")
    .select("id, tier")
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle();

  if (lookupError) {
    console.error("[kira-api:telegram] profile lookup failed:", lookupError.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  if (existing) {
    const { count } = await supabase
      .from("kira_roster_wallets")
      .select("id", { count: "exact", head: true })
      .eq("user_id", existing.id);

    res.json({ linked: true, tier: existing.tier, walletCount: count ?? 0 });
    return;
  }

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email: `telegram+${telegramUserId}@kira.ceronix.ai`,
    email_confirm: true,
    user_metadata: { telegram_user_id: telegramUserId, source: "telegram" },
  });

  if (createError || !created.user) {
    console.error("[kira-api:telegram] shadow user creation failed:", createError?.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  const { error: profileError } = await supabase.from("kira_profiles").insert({
    id: created.user.id,
    telegram_user_id: telegramUserId,
    telegram_username: telegramUsername ?? null,
  });

  if (profileError) {
    console.error("[kira-api:telegram] profile insert failed:", profileError.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  const code = generateLinkCode();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  const { error: codeError } = await supabase
    .from("kira_link_codes")
    .insert({ code, user_id: created.user.id, expires_at: expiresAt });

  if (codeError) {
    console.error("[kira-api:telegram] link code insert failed:", codeError.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  res.status(201).json({ linked: false, code });
});

export default router;
