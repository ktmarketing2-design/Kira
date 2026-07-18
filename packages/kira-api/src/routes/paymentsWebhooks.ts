import crypto from "node:crypto";
import { Router } from "express";
import { supabase } from "../lib/supabase.js";

const router = Router();

// ============================================================================
// Lemon Squeezy webhook (card payments). No Supabase JWT -- Lemon Squeezy's own servers call
// this directly, authenticity is established by the HMAC signature instead (verified against
// req.rawBody, the exact bytes Lemon Squeezy signed -- see index.ts's express.json verify
// callback for why the raw buffer, not the parsed body, is needed here).
// ============================================================================

function verifyLemonSqueezySignature(rawBody: Buffer | undefined, signatureHeader: string | undefined): boolean {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  if (!secret || !rawBody || !signatureHeader) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(signatureHeader, "hex");
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

interface LemonSqueezyWebhookPayload {
  meta: {
    event_name: string;
    custom_data?: { user_id?: string };
  };
  data: {
    attributes: {
      status: string;
      customer_id: number;
      variant_id: number;
      user_email?: string;
    };
    id: string;
  };
}

router.post("/lemonsqueezy", async (req, res) => {
  const signature = req.headers["x-signature"];
  if (!verifyLemonSqueezySignature(req.rawBody, typeof signature === "string" ? signature : undefined)) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  const payload = req.body as LemonSqueezyWebhookPayload;
  const eventName = payload.meta?.event_name;
  const userId = payload.meta?.custom_data?.user_id;
  const subscriptionId = payload.data?.id;
  const variantId = payload.data?.attributes?.variant_id;
  const status = payload.data?.attributes?.status;

  if (!userId) {
    // Not necessarily an error -- test-mode pings and non-subscription events won't carry our
    // custom_data. Ack with 200 either way so Lemon Squeezy doesn't retry indefinitely.
    res.status(200).json({ received: true, note: "no user_id in custom_data, ignored" });
    return;
  }

  const tierByVariant: Record<string, "pro" | "elite"> = {
    [process.env.LEMONSQUEEZY_PRO_VARIANT_ID ?? ""]: "pro",
    [process.env.LEMONSQUEEZY_ELITE_VARIANT_ID ?? ""]: "elite",
  };
  const tier = tierByVariant[String(variantId)];

  if (eventName === "subscription_created" || eventName === "subscription_updated") {
    if (status === "active" && tier) {
      await supabase
        .from("kira_profiles")
        .update({ tier, lemonsqueezy_subscription_id: subscriptionId })
        .eq("id", userId);

      await supabase.from("kira_payments").upsert(
        {
          user_id: userId,
          provider: "lemonsqueezy",
          external_id: subscriptionId,
          tier,
          amount_usd: tier === "elite" ? 79 : 29,
          status: "active",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "provider,external_id" },
      );
    }
  } else if (eventName === "subscription_cancelled" || eventName === "subscription_expired") {
    await supabase.from("kira_profiles").update({ tier: "scout" }).eq("id", userId);
    await supabase
      .from("kira_payments")
      .update({ status: eventName === "subscription_cancelled" ? "cancelled" : "expired", updated_at: new Date().toISOString() })
      .eq("provider", "lemonsqueezy")
      .eq("external_id", subscriptionId);
  }

  res.status(200).json({ received: true });
});

// ============================================================================
// NOWPayments IPN (crypto payments). NOWPayments' documented signature scheme sorts the
// response object's keys alphabetically before re-stringifying and HMAC-SHA512'ing it -- unlike
// Lemon Squeezy, it is NOT a signature over the raw bytes as received, so req.rawBody isn't used
// here, the parsed+resorted body is.
// ============================================================================

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce((acc: Record<string, unknown>, key) => {
        acc[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

function verifyNowPaymentsSignature(body: unknown, signatureHeader: string | undefined): boolean {
  const secret = process.env.NOWPAYMENTS_IPN_SECRET;
  if (!secret || !signatureHeader) return false;
  const sorted = JSON.stringify(sortKeysDeep(body));
  const expected = crypto.createHmac("sha512", secret).update(sorted).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(signatureHeader, "hex");
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

interface NowPaymentsIpnPayload {
  payment_id: string;
  payment_status: string;
  order_id?: string;
}

router.post("/nowpayments", async (req, res) => {
  const signature = req.headers["x-nowpayments-sig"];
  if (!verifyNowPaymentsSignature(req.body, typeof signature === "string" ? signature : undefined)) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  const payload = req.body as NowPaymentsIpnPayload;

  if (payload.payment_status === "expired") {
    res.status(200).json({ received: true });
    return;
  }

  const { data: payment } = await supabase
    .from("kira_payments")
    .select("user_id, tier")
    .eq("provider", "nowpayments")
    .eq("external_id", payload.payment_id)
    .maybeSingle();

  if (!payment) {
    res.status(200).json({ received: true, note: "no matching kira_payments row" });
    return;
  }

  if (payload.payment_status === "finished" || payload.payment_status === "confirmed") {
    await supabase.from("kira_profiles").update({ tier: payment.tier }).eq("id", payment.user_id);
    await supabase
      .from("kira_payments")
      .update({ status: "active", updated_at: new Date().toISOString() })
      .eq("provider", "nowpayments")
      .eq("external_id", payload.payment_id);
  }

  res.status(200).json({ received: true });
});

export default router;
