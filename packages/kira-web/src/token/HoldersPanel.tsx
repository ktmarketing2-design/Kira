interface TopHolder {
  address: string;
  pct: number | null;
  isDev: boolean;
}

function truncate(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

/** Top 5 holders from the DD card's topHolders field (raw token-account balances, not
 * owner-deduplicated). LP-wallet badges are not shown, there is no reliable LP account address
 * available from any data source Kira currently has, only dev-wallet detection works (matched
 * against RugCheck's deployerAddress). */
export default function HoldersPanel({ holders, top10HolderPct }: { holders: TopHolder[]; top10HolderPct: number | null }) {
  if (holders.length === 0) {
    return (
      <div className="bg-kira-surface border border-kira-border rounded-md p-8 text-center text-kira-text-muted text-sm">
        No holder data available for this token.
      </div>
    );
  }

  return (
    <div className="bg-kira-surface border border-kira-border rounded-md p-4">
      {top10HolderPct != null && (
        <div className="mb-4">
          <div className="flex items-center justify-between text-xs text-kira-text-muted mb-1">
            <span>Top 10 holders</span>
            <span className="font-data">{top10HolderPct.toFixed(1)}%</span>
          </div>
          <div className="h-2 w-full rounded-full overflow-hidden bg-kira-surface-2">
            <div
              className={`h-full ${top10HolderPct > 50 ? "bg-kira-red" : "bg-kira-accent"}`}
              style={{ width: `${Math.min(100, top10HolderPct)}%` }}
            />
          </div>
        </div>
      )}

      <div className="space-y-2">
        {holders.map((h, i) => (
          <div key={h.address} className="flex items-center justify-between text-xs font-data">
            <div className="flex items-center gap-2">
              <span className="text-kira-text-dim w-4">{i + 1}</span>
              <a
                href={`https://solscan.io/account/${h.address}`}
                target="_blank"
                rel="noreferrer"
                className="text-kira-accent hover:underline"
              >
                {truncate(h.address)}
              </a>
              {h.isDev && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-kira-yellow/20 text-kira-yellow">DEV</span>
              )}
            </div>
            <span className="text-kira-text-muted">{h.pct != null ? `${h.pct.toFixed(2)}%` : "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
