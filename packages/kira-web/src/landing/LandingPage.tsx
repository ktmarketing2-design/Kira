const PROBLEMS = [
  {
    quote: "Five tabs open.\nStill late to the move.",
    body: "Tracking wallets across Birdeye, DexScreener, Telegram, and Twitter simultaneously is how you miss the entry. Kira watches everything so you don't have to.",
  },
  {
    quote: "Volume looks real.\nIt isn't.",
    body: "Paid volume leaves fingerprints. FDV vs liquidity ratios, timing entropy, wallet cycling patterns. Kira's Volume Authenticity Engine scores every token before you ape.",
  },
  {
    quote: "KOL called it.\nBut did they own it first?",
    body: "Track which callers are actually right, not just loud. Kira scores every call against real on-chain price data and builds a credibility record over time.",
  },
];

const STEPS = [
  { n: 1, title: "CLUSTER ALERT", body: "2+ of your tracked wallets\nbuy the same token" },
  { n: 2, title: "TOKEN DEEP DIVE", body: "Auto-generated in seconds.\nRug score, volume score,\nsocial signals, market data." },
  { n: 3, title: "VOLUME CHECK", body: "Is the volume real?\nAuthenticity score with\nfull signal breakdown." },
  { n: 4, title: "SMART MONEY", body: "Are labeled wallets\nalso entering?\nCross-confirmed signal." },
  { n: 5, title: "DECIDE", body: "All signals in one place.\nYour call. Your edge." },
];

const FEATURES = [
  {
    icon: "🔍",
    title: "Wallet Cluster Alerts",
    body: "Track wallets you respect. When 2 or more buy the same token within your time window, you get alerted immediately on Telegram and web. First-mover detection included.",
  },
  {
    icon: "🛡",
    title: "Token Deep Dive",
    body: "One-click due diligence. Rug score, honeypot check, LP lock status, deployer history, top holder concentration. Under 10 seconds, every time.",
  },
  {
    icon: "📊",
    title: "Volume Authenticity Engine",
    body: "Six-signal scoring system detects wash trading, bot volume, and manufactured hype before you read the chart wrong.",
  },
  {
    icon: "📡",
    title: "Social Signals",
    body: "Know when your tracked KOL channels have called a token. See DexScreener trending status. Built from real ingestion data, not guesswork.",
  },
];

const PRICING_ROWS: Array<[string, string, string, string]> = [
  ["Wallet Roster", "5 wallets", "50 wallets", "Unlimited"],
  ["Cluster threshold", "3+ wallets", "2+ wallets", "2+ wallets"],
  ["Token Deep Dives", "10/day", "Unlimited", "Unlimited"],
  ["Alerts", "Web only", "Telegram + Web", "Telegram + Web"],
  ["Signal Filters", "—", "5 filters", "Unlimited"],
  ["KOL Tracker", "View only", "20 accounts", "Unlimited"],
];

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="font-display text-2xl sm:text-3xl text-kira-text text-center mb-10">{children}</h2>;
}

export default function LandingPage() {
  return (
    <div className="bg-kira-bg text-kira-text">
      {/* Section 1: Hero */}
      <section className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden kira-grid-bg px-4">
        <div className="kira-scanlines absolute inset-0 pointer-events-none" />
        <div className="relative text-center max-w-2xl">
          <div className="font-display text-4xl sm:text-6xl tracking-widest mb-1">KIRA</div>
          <div className="text-kira-text-muted text-sm mb-8">by Ceronix Labs</div>

          <p className="text-xl sm:text-2xl text-kira-text mb-2">See what others miss.</p>
          <p className="text-xl sm:text-2xl text-kira-accent mb-6">Before they miss it.</p>

          <p className="text-kira-text-muted text-sm sm:text-base leading-relaxed mb-8 max-w-xl mx-auto">
            Wallet cluster alerts, volume authenticity, on-chain DD, smart money tracking, and social signals.
            Unified.
          </p>

          <div className="flex items-center justify-center gap-4 mb-10">
            <a
              href="/login"
              className="bg-kira-accent text-kira-bg font-medium text-sm px-5 py-2.5 rounded hover:opacity-90 transition-opacity"
            >
              Start Free
            </a>
            <a
              href="#demo"
              className="text-kira-text text-sm px-5 py-2.5 rounded border border-kira-border hover:border-kira-accent transition-colors"
            >
              View Demo →
            </a>
          </div>

          <div className="font-data text-xs text-kira-text-dim">
            12,847 tokens analyzed &nbsp;•&nbsp; 3,291 cluster alerts fired &nbsp;•&nbsp; 847 rug risks flagged
          </div>
        </div>
      </section>

      {/* Section 2: The Problem */}
      <section className="py-24 px-4 border-t border-kira-border">
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
          {PROBLEMS.map((p) => (
            <div
              key={p.quote}
              className="bg-kira-surface border border-kira-border rounded-md p-6 hover:bg-kira-surface-2 transition-colors"
            >
              <p className="font-display text-lg text-kira-text whitespace-pre-line mb-3">{p.quote}</p>
              <div className="text-kira-border mb-3">——————————————</div>
              <p className="text-kira-text-muted text-sm leading-relaxed">{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Section 3: How It Works */}
      <section id="demo" className="py-24 px-4 border-t border-kira-border">
        <SectionHeading>How It Works</SectionHeading>
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-stretch justify-between gap-6">
          {STEPS.map((s, i) => (
            <div key={s.n} className="flex md:flex-col items-center gap-4 md:gap-3 flex-1">
              <div className="text-center flex-1">
                <div className="font-data text-kira-accent text-xs mb-1">{s.n}.</div>
                <div className="font-display text-sm text-kira-text mb-2">{s.title}</div>
                <p className="text-kira-text-muted text-xs whitespace-pre-line leading-relaxed">{s.body}</p>
              </div>
              {i < STEPS.length - 1 && (
                <div className="text-kira-border text-xl md:rotate-90 shrink-0">↓</div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Section 4: Feature Highlights */}
      <section className="py-24 px-4 border-t border-kira-border">
        <SectionHeading>Built for the way you actually trade</SectionHeading>
        <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-2 gap-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-kira-surface border border-kira-border rounded-md p-6">
              <div className="text-2xl mb-2">{f.icon}</div>
              <div className="font-display text-sm text-kira-text mb-2">{f.title}</div>
              <p className="text-kira-text-muted text-sm leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Section 5: Pricing */}
      <section className="py-24 px-4 border-t border-kira-border">
        <SectionHeading>Pricing</SectionHeading>
        <div className="max-w-4xl mx-auto overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr>
                <th className="text-left p-3 text-kira-text-muted font-normal"></th>
                <th className="p-3 text-kira-text font-display border-b border-kira-border">Scout</th>
                <th className="p-3 text-kira-accent font-display border-b border-kira-border">Pro</th>
                <th className="p-3 text-kira-yellow font-display border-b border-kira-border">Elite</th>
              </tr>
            </thead>
            <tbody>
              {PRICING_ROWS.map((row) => (
                <tr key={row[0]} className="border-b border-kira-border">
                  <td className="p-3 text-kira-text-muted">{row[0]}</td>
                  <td className="p-3 text-center text-kira-text font-data text-xs">{row[1]}</td>
                  <td className="p-3 text-center text-kira-text font-data text-xs">{row[2]}</td>
                  <td className="p-3 text-center text-kira-text font-data text-xs">{row[3]}</td>
                </tr>
              ))}
              <tr>
                <td className="p-3"></td>
                <td className="p-4 text-center">
                  <a href="/login" className="text-xs border border-kira-border rounded px-3 py-2 inline-block hover:border-kira-accent">
                    Get Started Free
                  </a>
                </td>
                <td className="p-4 text-center">
                  <a href="/login" className="text-xs bg-kira-accent text-kira-bg rounded px-3 py-2 inline-block hover:opacity-90">
                    Start Pro Trial
                  </a>
                </td>
                <td className="p-4 text-center">
                  <a href="/login" className="text-xs border border-kira-yellow text-kira-yellow rounded px-3 py-2 inline-block hover:bg-kira-yellow/10">
                    Go Elite
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Section 6: Built by Ceronix Labs */}
      <section className="py-24 px-4 border-t border-kira-border text-center">
        <p className="text-kira-text-muted text-sm max-w-lg mx-auto leading-relaxed">
          Kira is built and operated by Ceronix Labs, a product studio building intelligence tools for the next
          generation of traders.
        </p>
        <a href="https://ceronix.ai" target="_blank" rel="noreferrer" className="text-kira-accent text-sm hover:underline mt-2 inline-block">
          ceronix.ai
        </a>
      </section>

      {/* Footer */}
      <footer className="py-10 px-4 border-t border-kira-border text-center">
        <div className="font-display text-sm text-kira-text mb-1">Kira by Ceronix Labs</div>
        <a
          href="https://t.me/KiraByCeronixBot"
          target="_blank"
          rel="noreferrer"
          className="text-kira-accent text-xs hover:underline"
        >
          @KiraByCeronixBot on Telegram
        </a>
        <div className="flex items-center justify-center gap-4 mt-4 text-xs text-kira-text-muted">
          <span className="opacity-60">Docs</span>
          <span className="opacity-60">Twitter</span>
          <a href="https://t.me/KiraByCeronixBot" target="_blank" rel="noreferrer" className="hover:text-kira-text">
            Telegram
          </a>
        </div>
        <p className="text-kira-text-dim text-[11px] mt-4">Not financial advice. Do your own research.</p>
      </footer>
    </div>
  );
}
