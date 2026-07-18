import { Link } from "react-router-dom";

const FEATURES = [
  {
    num: "01",
    title: "Wallet Cluster Alerts",
    body: "Get notified the moment 2 or more tracked wallets buy the same token. Follow the smart money before it moves the chart.",
  },
  {
    num: "02",
    title: "Token Deep Dive",
    body: "Full rug check on any contract: LP status, holder concentration, mint authority, and history in one view.",
  },
  {
    num: "03",
    title: "Volume Authenticity",
    body: "A 0-100 score that separates real demand from wash trading and bot volume, computed in real time.",
  },
  {
    num: "04",
    title: "KOL Call Tracking",
    body: "See what top callers are posting across Telegram the moment it happens, with historical hit-rate attached.",
  },
  {
    num: "05",
    title: "Smart Money Digest",
    body: "Daily rollup of what the wallets that matter are accumulating, distributing, or rotating into.",
  },
  {
    num: "06",
    title: "Chart Studio",
    body: "Overlay cluster activity and KOL calls directly on price action. See the signal, not just the candle.",
  },
];

const TIERS = [
  {
    name: "Scout",
    price: "$0",
    features: ["Basic wallet alerts", "Token deep dive lookups", "Telegram bot access", "Delayed KOL feed"],
    featured: false,
    cta: "Get Started",
  },
  {
    name: "Pro",
    price: "$29",
    features: ["Real-time cluster alerts", "Volume authenticity scoring", "Live KOL call tracking", "Daily smart money digest"],
    featured: true,
    cta: "Upgrade to Pro",
  },
  {
    name: "Elite",
    price: "$79",
    features: ["Everything in Pro", "Chart Studio overlays", "Priority signal delivery", "Custom wallet lists"],
    featured: false,
    cta: "Go Elite",
  },
];

function Logo({ className = "" }: { className?: string }) {
  return (
    <Link to="/" className={`flex items-center gap-2.5 ${className}`}>
      <img src="/kira-logo.jpeg" alt="Kira by Ceronix Labs" className="h-6 w-[72px] object-cover object-center rounded-[3px]" />
    </Link>
  );
}

export default function LandingPage() {
  return (
    <div className="bg-tt-bg text-tt-fg font-body text-[13px] tracking-[0.02em] leading-relaxed min-h-screen">
      <div className="tt-noise" />
      <div className="tt-scanlines" />

      <nav className="border-b border-tt-border px-6 md:px-12 py-5 flex justify-between items-center sticky top-0 bg-tt-bg/92 backdrop-blur-sm z-50">
        <Logo />
        <div className="hidden md:flex gap-9 items-center">
          <Link to="/signals" className="text-tt-fg-dim text-xs tracking-[0.08em] uppercase hover:text-tt-fg transition-colors">
            Signals
          </Link>
          <Link to="/roster" className="text-tt-fg-dim text-xs tracking-[0.08em] uppercase hover:text-tt-fg transition-colors">
            Wallets
          </Link>
          <a href="#pricing" className="text-tt-fg-dim text-xs tracking-[0.08em] uppercase hover:text-tt-fg transition-colors">
            Pricing
          </a>
          <span className="text-tt-fg-dim text-xs tracking-[0.08em] uppercase opacity-50 cursor-not-allowed">Docs</span>
          <a
            href="https://t.me/kira_ceronix_bot"
            target="_blank"
            rel="noreferrer"
            className="text-tt-fg-dim text-xs tracking-[0.08em] uppercase hover:text-tt-fg transition-colors"
          >
            Telegram
          </a>
        </div>
        <Link
          to="/login"
          className="font-body text-xs tracking-[0.08em] uppercase px-5 py-2.5 rounded-md border border-tt-brand text-tt-brand hover:bg-tt-brand hover:text-tt-bg transition-colors"
        >
          Launch App
        </Link>
      </nav>

      <div className="border-b border-tt-border px-6 md:px-12 py-3.5 flex gap-12 overflow-hidden text-[11px] text-tt-fg-dim tracking-[0.08em] whitespace-nowrap">
        <span>
          WALLET_CLUSTER <span className="text-tt-green">▲ 3 tracked wallets bought $BONK</span>
        </span>
        <span className="hidden sm:inline">
          RUG_CHECK <span className="text-tt-red">▼ LP unlocked flag on $PUMP</span>
        </span>
        <span className="hidden md:inline">
          SMART_MONEY <span className="text-tt-green">▲ 9 wallets in accumulation</span>
        </span>
        <span className="hidden lg:inline">
          VOLUME_SCORE <span className="text-tt-green">▲ 92/100 authentic on $WIF</span>
        </span>
      </div>

      <div className="border-b border-tt-border px-6 md:px-12 py-16 md:py-24 grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-12 lg:gap-16">
        <div>
          <div className="inline-flex items-center gap-2 border border-tt-border rounded-md px-3 py-1.5 mb-7 text-[11px] tracking-[0.1em] uppercase text-tt-fg-dim">
            <span className="text-tt-brand">●</span> Live on Solana Mainnet
          </div>
          <h1 className="font-display uppercase text-5xl sm:text-6xl lg:text-7xl leading-[0.95] tracking-[-0.02em] mb-7">
            See what
            <br />
            smart wallets
            <br />
            <span className="text-tt-brand">see first.</span>
          </h1>
          <p className="text-tt-fg-dim text-[15px] max-w-lg mb-9 leading-relaxed">
            Kira tracks wallet clusters, scores volume authenticity, and flags rugs in real time so you're not trading
            blind. Built for Solana degens who want an edge, not noise.
          </p>
          <div className="flex flex-wrap gap-4">
            <Link
              to="/login"
              className="font-body text-xs tracking-[0.08em] uppercase px-5 py-2.5 rounded-md border border-tt-brand text-tt-brand hover:bg-tt-brand hover:text-tt-bg transition-colors"
            >
              Start Free — Scout Tier
            </Link>
            <a
              href="https://t.me/kira_ceronix_bot"
              target="_blank"
              rel="noreferrer"
              className="font-body text-xs tracking-[0.08em] uppercase px-5 py-2.5 rounded-md border border-tt-fg text-tt-fg hover:bg-tt-fg hover:text-tt-bg transition-colors"
            >
              Open Telegram Bot
            </a>
          </div>
        </div>

        <div className="border border-tt-border bg-tt-bg-raised rounded-md p-5 self-start">
          <div className="flex justify-between border-b border-tt-border pb-3 mb-4 text-[11px] text-tt-fg-dim tracking-[0.1em]">
            <span>CLUSTER_ALERT</span>
            <span>LIVE</span>
          </div>
          <div className="flex justify-between py-2.5 border-b border-tt-border text-xs">
            <span className="text-tt-fg-faint text-[11px]">3 WALLETS &gt; $WIF</span>
            <span className="text-tt-green">+18.4%</span>
          </div>
          <div className="flex justify-between py-2.5 border-b border-tt-border text-xs">
            <span className="text-tt-fg-faint text-[11px]">RUG_SCORE $PUMP</span>
            <span className="text-tt-red">HIGH RISK</span>
          </div>
          <div className="flex justify-between py-2.5 border-b border-tt-border text-xs">
            <span className="text-tt-fg-faint text-[11px]">VOL_AUTH $BONK</span>
            <span className="text-tt-green">92 / 100</span>
          </div>
          <div className="flex justify-between py-2.5 border-b border-tt-border text-xs">
            <span className="text-tt-fg-faint text-[11px]">KOL_CALL @spydefi</span>
            <span className="text-tt-green">$MOON 4m ago</span>
          </div>
          <div className="flex justify-between py-2.5 text-xs">
            <span className="text-tt-fg-faint text-[11px]">SMART_MONEY IDX</span>
            <span className="text-tt-green">ACCUMULATING</span>
          </div>
        </div>
      </div>

      <section className="px-6 md:px-12 py-16 md:py-24 border-b border-tt-border">
        <div className="flex justify-between items-end mb-12">
          <h2 className="font-display uppercase text-3xl md:text-4xl tracking-[-0.01em]">Intelligence layer</h2>
          <div className="text-xs text-tt-fg-faint tracking-[0.1em] hidden sm:block">[ 01 — 06 ]</div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-tt-border border border-tt-border rounded-md overflow-hidden">
          {FEATURES.map((f) => (
            <div key={f.num} className="bg-tt-bg p-7">
              <div className="text-[11px] text-tt-fg-faint mb-5 tracking-[0.1em]">{f.num} /</div>
              <h3 className="font-display uppercase text-base mb-3 tracking-[0.01em]">{f.title}</h3>
              <p className="text-tt-fg-dim text-[13px] leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="pricing" className="px-6 md:px-12 py-16 md:py-24 border-b border-tt-border">
        <div className="flex justify-between items-end mb-12">
          <h2 className="font-display uppercase text-3xl md:text-4xl tracking-[-0.01em]">Access tiers</h2>
          <div className="text-xs text-tt-fg-faint tracking-[0.1em] hidden sm:block">[ SCOUT / PRO / ELITE ]</div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-tt-border border border-tt-border rounded-md overflow-hidden">
          {TIERS.map((t) => (
            <div key={t.name} className={`relative p-9 ${t.featured ? "bg-tt-bg-raised" : "bg-tt-bg"}`}>
              {t.featured && (
                <div className="absolute top-0 left-7 -translate-y-full bg-tt-brand text-tt-bg text-[10px] tracking-[0.1em] px-2 py-1 rounded-t">
                  [ RECOMMENDED ]
                </div>
              )}
              <div className="font-display uppercase text-lg mb-2">{t.name}</div>
              <div className="text-3xl text-tt-brand font-semibold mb-6">
                {t.price}
                <span className="text-xs text-tt-fg-dim">/mo</span>
              </div>
              <ul className="mb-7">
                {t.features.map((li) => (
                  <li key={li} className="text-xs text-tt-fg-dim py-2 border-t border-tt-border flex gap-2.5">
                    <span className="text-tt-brand">&gt;</span>
                    {li}
                  </li>
                ))}
              </ul>
              <Link
                to="/login"
                className={`block w-full text-center font-body text-xs tracking-[0.08em] uppercase px-5 py-2.5 rounded-md border transition-colors ${
                  t.featured
                    ? "border-tt-brand text-tt-brand hover:bg-tt-brand hover:text-tt-bg"
                    : "border-tt-fg text-tt-fg hover:bg-tt-fg hover:text-tt-bg"
                }`}
              >
                {t.cta}
              </Link>
            </div>
          ))}
        </div>
      </section>

      <div className="px-6 md:px-12 py-20 md:py-24 text-center">
        <h2 className="font-display uppercase text-3xl md:text-5xl tracking-[-0.01em] mb-5">Stop trading blind.</h2>
        <p className="text-tt-fg-dim mb-9 text-sm">Free to start. No credit card. Live in under 60 seconds.</p>
        <Link
          to="/login"
          className="inline-block font-body text-xs tracking-[0.08em] uppercase px-5 py-2.5 rounded-md border border-tt-brand text-tt-brand hover:bg-tt-brand hover:text-tt-bg transition-colors"
        >
          Launch Kira Free
        </Link>
      </div>

      <footer className="px-6 md:px-12 py-10 flex flex-col sm:flex-row gap-2 justify-between text-[11px] text-tt-fg-faint tracking-[0.08em]">
        <span>KIRA BY CERONIX LABS © 2026</span>
        <span>SOLANA MAINNET / STATUS: OPERATIONAL</span>
      </footer>
    </div>
  );
}
