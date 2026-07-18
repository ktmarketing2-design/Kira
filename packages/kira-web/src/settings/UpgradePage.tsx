import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { apiRequest, ApiError } from "../lib/api.js";
import { useAppData } from "../shell/AppDataContext.js";

const TIERS = [
  { key: "scout" as const, name: "Scout", price: "Free", features: ["5 wallets", "1 signal filter", "3 /ask per day", "10 watchlist", "3 KOL sources"] },
  { key: "pro" as const, name: "Pro", price: "$29/mo", features: ["20 wallets", "5 filters", "10 /ask per day", "100 watchlist", "20 KOL sources"] },
  { key: "elite" as const, name: "Elite", price: "$79/mo", features: ["Unlimited wallets", "Unlimited filters", "Unlimited /ask", "Unlimited watchlist", "Unlimited KOL sources"] },
];

const CRYPTO_CURRENCIES = ["SOL", "USDC", "BTC"] as const;

interface CryptoInvoice {
  invoiceId: string;
  paymentUrl: string | null;
  qrCode: string;
  address: string;
  amount: number;
  currency: string;
  expiresAt: string | null;
}

function CryptoModal({ tier, onClose }: { tier: "pro" | "elite"; onClose: () => void }) {
  const [currency, setCurrency] = useState<(typeof CRYPTO_CURRENCIES)[number]>("SOL");
  const [invoice, setInvoice] = useState<CryptoInvoice | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function createInvoice() {
    setLoading(true);
    setError(null);
    setInvoice(null);
    try {
      const res = await apiRequest<CryptoInvoice>("POST", "/payments/crypto/create", { tier, currency });
      setInvoice(res);
    } catch (err) {
      setError(err instanceof ApiError ? String((err.body as { error?: string })?.error ?? err.message) : "Couldn't create invoice");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void createInvoice();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency]);

  useEffect(() => {
    if (!invoice) return;
    pollRef.current = setInterval(() => {
      apiRequest<{ tier: string }>("GET", "/payments/subscription")
        .then((res) => {
          if (res.tier === tier) {
            setConfirmed(true);
            if (pollRef.current) clearInterval(pollRef.current);
          }
        })
        .catch(() => {});
    }, 10_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [invoice, tier]);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
      <div className="bg-tt-bg-raised border border-tt-border rounded-md p-6 max-w-sm w-full">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display uppercase text-sm text-tt-fg">Pay with Crypto</h2>
          <button onClick={onClose} className="text-tt-fg-faint hover:text-tt-fg text-sm">
            ✕
          </button>
        </div>

        {confirmed ? (
          <div className="text-center py-6">
            <div className="text-tt-green text-2xl mb-2">✓</div>
            <p className="text-sm text-tt-fg">Payment confirmed. You're now on {tier}.</p>
          </div>
        ) : (
          <>
            <div className="flex gap-2 mb-4">
              {CRYPTO_CURRENCIES.map((c) => (
                <button
                  key={c}
                  onClick={() => setCurrency(c)}
                  className={`text-xs px-3 py-1.5 rounded-md border ${
                    currency === c ? "border-tt-brand text-tt-brand" : "border-tt-border text-tt-fg-dim"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>

            {loading && <p className="text-xs text-tt-fg-dim text-center py-8">Creating invoice...</p>}
            {error && <p className="text-xs text-tt-red text-center py-4">{error}</p>}

            {invoice && !loading && (
              <div className="text-center space-y-3">
                <div className="bg-white p-3 rounded-md inline-block">
                  <QRCodeSVG value={invoice.qrCode} size={160} />
                </div>
                <p className="text-xs text-tt-fg-dim break-all font-data">{invoice.address}</p>
                <p className="text-sm text-tt-fg">
                  {invoice.amount} {invoice.currency.toUpperCase()}
                </p>
                <p className="text-[10px] text-tt-fg-faint">Waiting for payment confirmation...</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function UpgradePage() {
  const { me } = useAppData();
  const currentTier = me?.tier ?? "scout";
  const [checkoutLoading, setCheckoutLoading] = useState<"pro" | "elite" | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [cryptoModalTier, setCryptoModalTier] = useState<"pro" | "elite" | null>(null);

  async function handlePayWithCard(tier: "pro" | "elite") {
    setCheckoutLoading(tier);
    setCheckoutError(null);
    try {
      const res = await apiRequest<{ checkoutUrl: string }>("POST", "/payments/checkout", {
        tier,
        successUrl: `${window.location.origin}/upgrade/success`,
        cancelUrl: `${window.location.origin}/upgrade`,
      });
      window.location.href = res.checkoutUrl;
    } catch (err) {
      setCheckoutError(err instanceof ApiError ? String((err.body as { error?: string })?.error ?? err.message) : "Couldn't start checkout");
      setCheckoutLoading(null);
    }
  }

  return (
    <div>
      <h1 className="font-display uppercase text-lg text-tt-fg mb-1">Upgrade Kira</h1>
      <p className="text-tt-fg-dim text-sm mb-6">Choose a tier and payment method.</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {TIERS.map((t) => (
          <div
            key={t.key}
            className={`bg-tt-bg-raised border rounded-md p-4 ${
              currentTier === t.key ? "border-tt-brand" : "border-tt-border"
            }`}
          >
            <div className="font-display text-tt-fg mb-1">
              {t.name} {currentTier === t.key && <span className="text-tt-brand text-xs">(Current)</span>}
            </div>
            <div className="text-tt-brand text-lg mb-3">{t.price}</div>
            <ul className="space-y-1 text-xs text-tt-fg-dim mb-4">
              {t.features.map((f) => (
                <li key={f}>· {f}</li>
              ))}
            </ul>
            {t.key !== "scout" && currentTier !== t.key && (
              <button
                onClick={() => void handlePayWithCard(t.key)}
                disabled={checkoutLoading === t.key}
                className="w-full text-xs bg-tt-brand text-tt-bg rounded-md px-3 py-2 disabled:opacity-50"
              >
                {checkoutLoading === t.key ? "Starting..." : `Upgrade to ${t.name}`}
              </button>
            )}
          </div>
        ))}
      </div>

      {checkoutError && <p className="text-xs text-tt-red mb-4">{checkoutError}</p>}

      {currentTier === "scout" && (
        <div className="bg-tt-bg-raised border border-tt-border rounded-md p-4">
          <div className="text-[10px] uppercase tracking-wide text-tt-fg-faint mb-3">Payment method</div>
          <div className="flex gap-3">
            <button
              onClick={() => void handlePayWithCard("pro")}
              className="text-xs bg-tt-bg-panel border border-tt-border text-tt-fg rounded-md px-4 py-2 hover:border-tt-brand"
            >
              💳 Pay with Card
            </button>
            <button
              onClick={() => setCryptoModalTier("pro")}
              className="text-xs bg-tt-bg-panel border border-tt-border text-tt-fg rounded-md px-4 py-2 hover:border-tt-brand"
            >
              🪙 Pay with Crypto
            </button>
          </div>
          <p className="text-[10px] text-tt-fg-faint mt-2">Defaults to Pro -- pick Elite above for that tier's card checkout.</p>
        </div>
      )}

      {cryptoModalTier && <CryptoModal tier={cryptoModalTier} onClose={() => setCryptoModalTier(null)} />}
    </div>
  );
}
