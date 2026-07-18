import { Router } from "express";
import { z } from "zod";
import { lemonSqueezySetup, createCheckout } from "@lemonsqueezy/lemonsqueezy.js";
import { supabase } from "../lib/supabase.js";
import { redis } from "../lib/redis.js";

const router = Router();

lemonSqueezySetup({ apiKey: process.env.LEMONSQUEEZY_API_KEY ?? "" });

const TIER_PRICES_USD: Record<"pro" | "elite", number> = { pro: 29, elite: 79 };

const VARIANT_ID_BY_TIER: Record<"pro" | "elite", string | undefined> = {
  pro: process.env.LEMONSQUEEZY_PRO_VARIANT_ID,
  elite: process.env.LEMONSQUEEZY_ELITE_VARIANT_ID,
};

const checkoutSchema = z.object({
  tier: z.enum(["pro", "elite"]),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

router.post("/checkout", async (req, res) => {
  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }

  const storeId = process.env.LEMONSQUEEZY_STORE_ID;
  const variantId = VARIANT_ID_BY_TIER[parsed.data.tier];
  if (!storeId || !variantId) {
    console.error("[kira-api:payments] LEMONSQUEEZY_STORE_ID or variant id missing from env");
    res.status(503).json({ error: "Card payments are not configured yet" });
    return;
  }

  try {
    const result = await createCheckout(storeId, variantId, {
      checkoutData: {
        email: req.user!.email,
        custom: { user_id: req.user!.id },
      },
      productOptions: {
        redirectUrl: parsed.data.successUrl,
      },
    });

    if (result.error || !result.data) {
      console.error("[kira-api:payments] createCheckout failed:", result.error?.message);
      res.status(502).json({ error: "Couldn't create checkout session" });
      return;
    }

    res.json({ checkoutUrl: result.data.data.attributes.url });
  } catch (err) {
    console.error("[kira-api:payments] checkout error:", err instanceof Error ? err.message : err);
    res.status(502).json({ error: "Couldn't create checkout session" });
  }
});

router.get("/subscription", async (req, res) => {
  const { data: profile, error: profileError } = await supabase
    .from("kira_profiles")
    .select("tier, tier_expires_at")
    .eq("id", req.user!.id)
    .maybeSingle();

  if (profileError) {
    console.error("[kira-api:payments] profile lookup failed:", profileError.message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  const { data: payment } = await supabase
    .from("kira_payments")
    .select("provider, tier, status, amount_usd, created_at, updated_at")
    .eq("user_id", req.user!.id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  res.json({
    tier: profile?.tier ?? "scout",
    tierExpiresAt: profile?.tier_expires_at ?? null,
    latestPayment: payment ?? null,
  });
});

// ============================================================================
// NOWPayments (crypto). No official maintained npm SDK exists under the name the spec assumed
// (`nowpayments-api-js` returns a 404 on the public registry, verified before writing this) --
// NOWPayments' REST API is simple enough that this calls it directly with fetch rather than
// installing an unrelated/unverified third-party package under a similar name.
// ============================================================================

const NOWPAYMENTS_API_BASE = "https://api.nowpayments.io/v1";
const CRYPTO_CURRENCIES = new Set(["sol", "usdc", "btc"]);

const cryptoCreateSchema = z.object({
  tier: z.enum(["pro", "elite"]),
  currency: z.enum(["SOL", "USDC", "BTC"]),
});

interface NowPaymentsInvoiceResponse {
  payment_id: string;
  pay_address: string;
  pay_amount: number;
  pay_currency: string;
  payment_status: string;
  expiration_estimate_date?: string;
}

router.post("/crypto/create", async (req, res) => {
  const parsed = cryptoCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }

  const apiKey = process.env.NOWPAYMENTS_API_KEY;
  if (!apiKey) {
    console.error("[kira-api:payments] NOWPAYMENTS_API_KEY missing from env");
    res.status(503).json({ error: "Crypto payments are not configured yet" });
    return;
  }

  const amountUsd = TIER_PRICES_USD[parsed.data.tier];
  const payCurrency = parsed.data.currency.toLowerCase();
  if (!CRYPTO_CURRENCIES.has(payCurrency)) {
    res.status(400).json({ error: "Unsupported currency" });
    return;
  }

  try {
    const response = await fetch(`${NOWPAYMENTS_API_BASE}/payment`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        price_amount: amountUsd,
        price_currency: "usd",
        pay_currency: payCurrency,
        order_id: `${req.user!.id}:${parsed.data.tier}:${Date.now()}`,
        order_description: `Kira ${parsed.data.tier} tier upgrade`,
        ipn_callback_url: "https://kira-api.ceronix.ai/payments/webhook/nowpayments",
      }),
    });

    if (!response.ok) {
      console.error("[kira-api:payments] NOWPayments create failed:", response.status, await response.text());
      res.status(502).json({ error: "Couldn't create crypto invoice" });
      return;
    }

    const data = (await response.json()) as NowPaymentsInvoiceResponse;

    await supabase.from("kira_payments").insert({
      user_id: req.user!.id,
      provider: "nowpayments",
      external_id: data.payment_id,
      tier: parsed.data.tier,
      amount_usd: amountUsd,
      status: "pending",
    });

    res.json({
      invoiceId: data.payment_id,
      paymentUrl: null, // in-app modal (address + QR), not a hosted redirect page
      qrCode: `${payCurrency}:${data.pay_address}?amount=${data.pay_amount}`,
      address: data.pay_address,
      amount: data.pay_amount,
      currency: data.pay_currency,
      expiresAt: data.expiration_estimate_date ?? null,
    });
  } catch (err) {
    console.error("[kira-api:payments] crypto create error:", err instanceof Error ? err.message : err);
    res.status(502).json({ error: "Couldn't create crypto invoice" });
  }
});

export default router;
