const TIERS = [
  { name: "Scout", price: "Free", features: ["5 wallets", "10 Deep Dives/day", "Threshold 3+", "Web alerts only"] },
  { name: "Pro", price: "$29/mo", features: ["50 wallets", "Unlimited Deep Dives", "Threshold 2+", "Telegram + Web alerts", "5 Signal Filters"] },
  { name: "Elite", price: "$79/mo", features: ["Unlimited wallets", "Threshold 2+", "Telegram + Web alerts", "Unlimited Signal Filters"] },
];

export default function UpgradePage() {
  return (
    <div>
      <h1 className="font-display text-lg text-kira-text mb-1">Upgrade</h1>
      <p className="text-kira-text-muted text-sm mb-6">Payment processing is coming soon.</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {TIERS.map((t) => (
          <div key={t.name} className="bg-kira-surface border border-kira-border rounded-md p-4">
            <div className="font-display text-kira-text mb-1">{t.name}</div>
            <div className="text-kira-accent text-lg mb-3">{t.price}</div>
            <ul className="space-y-1 text-xs text-kira-text-muted mb-4">
              {t.features.map((f) => (
                <li key={f}>• {f}</li>
              ))}
            </ul>
            <button
              disabled
              title="Coming soon"
              className="w-full text-xs bg-kira-surface-2 border border-kira-border text-kira-text-dim rounded px-3 py-2 cursor-not-allowed"
            >
              Coming soon
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
