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


// ============================================================================
// Sprint 10 Part 4: bot-initiated account linking, both directions.
// ============================================================================

const linkCodeSchema = z.object({
  code: z.string().min(1),
  telegramUserId: z.number().int(),
  telegramUsername: z.string().optional(),
});

/**
 * Bot's /link {code} command: the web Settings page generated `code` for the currently-logged-in
 * user (see routes/auth.ts's POST /auth/telegram-link-code). Directly assigns this Telegram
 * identity to that same profile -- clearing it from any other profile first, mirroring the
 * merge-safety in /auth/telegram-link, since telegram_user_id is unique on kira_profiles.
 */
router.post("/link", async (req, res) => {
  if (!requireBotToken(req, res)) return;

  const parsed = linkCodeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }
  const { code, telegramUserId, telegramUsername } = parsed.data;

  const { data: linkCode, error: codeError } = await supabase
    .from("kira_link_codes")
    .select("code, user_id, expires_at, used, telegram_user_id_pending")
    .eq("code", code)
    .maybeSingle();

  if (codeError) {
    console.error("[kira-api:telegram] link code lookup failed:", codeError.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }
  if (!linkCode || linkCode.telegram_user_id_pending != null) {
    // telegram_user_id_pending set means this code belongs to the *other* (email-initiated)
    // flow, not a code the bot should ever consume directly.
    res.status(404).json({ error: "Invalid code" });
    return;
  }
  if (linkCode.used) {
    res.status(410).json({ error: "Code already used" });
    return;
  }
  if (new Date(linkCode.expires_at).getTime() < Date.now()) {
    res.status(410).json({ error: "Code expired" });
    return;
  }

  const { data: conflictingProfile } = await supabase
    .from("kira_profiles")
    .select("id")
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle();

  if (conflictingProfile && conflictingProfile.id !== linkCode.user_id) {
    await supabase
      .from("kira_profiles")
      .update({ telegram_user_id: null, telegram_username: null })
      .eq("id", conflictingProfile.id);
  }

  const { error: assignError } = await supabase
    .from("kira_profiles")
    .update({ telegram_user_id: telegramUserId, telegram_username: telegramUsername ?? null })
    .eq("id", linkCode.user_id);

  if (assignError) {
    console.error("[kira-api:telegram] link assign failed:", assignError.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  await supabase.from("kira_link_codes").update({ used: true }).eq("code", code);
  res.json({ linked: true });
});

const linkEmailSchema = z.object({
  telegramUserId: z.number().int(),
  telegramUsername: z.string().optional(),
  email: z.string().email(),
});

/**
 * Bot's /link {email} command: the opposite direction from POST /link above -- initiated from
 * Telegram, targeting an existing *email* account. Looks the account up via the admin API (no
 * direct getUserByEmail in supabase-js; listUsers + filter is adequate at this app's current
 * scale, flagged here as a real limitation to revisit if the user base grows large enough for
 * pagination to matter), creates a kira_link_codes row carrying the pending Telegram identity
 * (since we don't want to touch the target profile until the human at that email address has
 * actually proven ownership by clicking the link), and sends a real Supabase magic-link email
 * whose redirect target is this app's existing /link/:code page -- reusing Supabase's own email
 * delivery (the same one the web login flow already depends on) rather than standing up a
 * separate transactional email sender for just this one flow.
 */
router.post("/link-email", async (req, res) => {
  if (!requireBotToken(req, res)) return;

  const parsed = linkEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }
  const { telegramUserId, telegramUsername, email } = parsed.data;

  let targetUserId: string | null = null;
  let page = 1;
  const perPage = 200;
  for (let i = 0; i < 10 && !targetUserId; i++) {
    const { data: page_, error: listError } = await supabase.auth.admin.listUsers({ page, perPage });
    if (listError || !page_) break;
    const match = page_.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (match) {
      targetUserId = match.id;
      break;
    }
    if (page_.users.length < perPage) break;
    page++;
  }

  if (!targetUserId) {
    res.status(404).json({ error: "No Kira account found for that email" });
    return;
  }

  const code = generateLinkCode();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  const { error: codeError } = await supabase.from("kira_link_codes").insert({
    code,
    user_id: targetUserId,
    expires_at: expiresAt,
    telegram_user_id_pending: telegramUserId,
    telegram_username_pending: telegramUsername ?? null,
  });

  if (codeError) {
    console.error("[kira-api:telegram] link-email code insert failed:", codeError.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  const { error: otpError } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `https://kira.ceronix.ai/link/${code}` },
  });

  if (otpError) {
    console.error("[kira-api:telegram] link-email OTP send failed:", otpError.message);
    res.status(502).json({ error: "Couldn't send verification email" });
    return;
  }

  res.status(201).json({ sent: true });
});

export default router;
