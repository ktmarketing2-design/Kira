import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";

const router = Router();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;

const widgetSchema = z.object({
  id: z.number().int(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  photo_url: z.string().optional(),
  auth_date: z.number().int(),
  hash: z.string(),
});

/**
 * Telegram Login Widget verification, per Telegram's documented algorithm
 * (https://core.telegram.org/widgets/login#checking-authorization): HMAC-SHA256 of the
 * newline-joined, alphabetically-sorted "key=value" fields (excluding hash) using
 * SHA256(bot_token) as the HMAC key. auth_date is also checked against MAX_AUTH_AGE_SECONDS to
 * reject a replayed old widget payload.
 */
function verifyTelegramWidget(data: Record<string, unknown>): boolean {
  if (!BOT_TOKEN) return false;
  const { hash, ...rest } = data as Record<string, string | number>;
  if (typeof hash !== "string") return false;

  const checkString = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${rest[key]}`)
    .join("\n");

  const secretKey = crypto.createHash("sha256").update(BOT_TOKEN).digest();
  const expected = crypto.createHmac("sha256", secretKey).update(checkString).digest("hex");

  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(hash, "hex");
  if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
    return false;
  }

  const authDate = Number(rest.auth_date);
  return Date.now() / 1000 - authDate < MAX_AUTH_AGE_SECONDS;
}

function shadowEmailFor(telegramUserId: number): string {
  return `telegram+${telegramUserId}@kira.ceronix.ai`;
}

/**
 * "Login with Telegram" via the widget on the login page. Public (no Supabase JWT, no bot-token
 * header) -- authenticity comes entirely from the widget's own HMAC signature, this endpoint's
 * whole purpose is to hand back credentials to establish a session, so it can't require one.
 *
 * Reuses the same shadow-user-by-synthetic-email pattern telegram.ts's bot /start route already
 * established for find-or-create, then uses supabase.auth.admin.generateLink (magiclink) to
 * mint a token this response can hand straight back to the frontend, which completes the sign-in
 * client-side via supabase.auth.verifyOtp -- no email is actually sent, we're just reusing
 * Supabase's own OTP verification path as the session-issuing mechanism for a login method
 * Supabase doesn't natively support.
 */
router.post("/telegram-login", async (req, res) => {
  const parsed = widgetSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }

  if (!verifyTelegramWidget(parsed.data)) {
    res.status(401).json({ error: "Invalid Telegram authentication data" });
    return;
  }

  const { id: telegramUserId, username } = parsed.data;

  const { data: existing, error: lookupError } = await supabase
    .from("kira_profiles")
    .select("id")
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle();

  if (lookupError) {
    console.error("[kira-api:auth] telegram-login profile lookup failed:", lookupError.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  const email = shadowEmailFor(telegramUserId);

  if (!existing) {
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { telegram_user_id: telegramUserId, source: "telegram" },
    });

    if (createError || !created.user) {
      console.error("[kira-api:auth] telegram-login user creation failed:", createError?.message);
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    const { error: profileError } = await supabase.from("kira_profiles").insert({
      id: created.user.id,
      telegram_user_id: telegramUserId,
      telegram_username: username ?? null,
    });

    if (profileError) {
      console.error("[kira-api:auth] telegram-login profile insert failed:", profileError.message);
      res.status(500).json({ error: "Internal server error" });
      return;
    }
  }

  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  if (linkError || !linkData) {
    console.error("[kira-api:auth] telegram-login link generation failed:", linkError?.message);
    res.status(502).json({ error: "Couldn't complete Telegram sign-in" });
    return;
  }

  res.json({
    email,
    token: linkData.properties.hashed_token,
  });
});

export default router;
