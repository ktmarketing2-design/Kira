import type { DdCard } from "../lib/types.js";

function fmtUsd(value: number | null): string {
  if (value == null) return "—";
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function StatusMark({ ok }: { ok: boolean }) {
  return <span className={ok ? "text-kira-green" : "text-kira-yellow"}>{ok ? "✅" : "⚠️"}</span>;
}

export default function DdCardView({ card }: { card: DdCard }) {
  const symbol = card.symbol ?? "Token";

  return (
    <div className="bg-kira-surface border border-kira-border rounded-md p-4 space-y-4">
      <div>
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="font-display text-lg text-kira-text">${symbol}</span>
          {card.name && <span className="text-kira-text-muted text-sm">{card.name}</span>}
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="font-data text-xs text-kira-text-muted">{card.tokenAddress}</span>
          <button
            onClick={() => void navigator.clipboard.writeText(card.tokenAddress)}
            className="text-xs text-kira-accent hover:underline"
          >
            Copy
          </button>
          <span className="text-xs text-kira-text-dim">Chain: Solana</span>
        </div>
        {card.statusLabel && <p className="text-xs text-kira-yellow mt-2 whitespace-pre-line">{card.statusLabel}</p>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-kira-text-muted mb-2">Safety</div>
          <div className="text-sm text-kira-text mb-1">Rug Score: {card.safety.rugScore}/100</div>
          <ul className="space-y-1 text-xs text-kira-text-muted">
            <li><StatusMark ok={card.safety.mintAuthorityRevoked} /> Mint revoked</li>
            <li><StatusMark ok={card.safety.freezeAuthorityRevoked} /> Freeze revoked</li>
            <li><StatusMark ok={card.safety.lpLocked} /> LP locked</li>
            <li><StatusMark ok={card.safety.honeypotClean} /> Not honeypot</li>
            {card.safety.top10HolderPct != null && (
              <li className="text-kira-text-dim">Top 10: {card.safety.top10HolderPct.toFixed(1)}% supply</li>
            )}
          </ul>
        </div>

        <div>
          <div className="text-xs uppercase tracking-wide text-kira-text-muted mb-2">Volume</div>
          {card.volume ? (
            <>
              <div className="text-sm text-kira-text mb-1">
                Vol Score: {card.volume.score}/100 ({card.volume.verdict})
              </div>
              <ul className="space-y-1 text-xs text-kira-text-muted">
                {card.volume.signals.map((s) => (
                  <li key={s.name} className={s.flag ? "text-kira-yellow" : ""}>
                    {s.name.replace(/_/g, " ")}: {s.value.toFixed(2)}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="text-xs text-kira-text-dim">Not available yet.</div>
          )}
        </div>

        <div>
          <div className="text-xs uppercase tracking-wide text-kira-text-muted mb-2">Market</div>
          <ul className="space-y-1 text-xs text-kira-text-muted font-data">
            <li>FDV: {fmtUsd(card.market.fdvUsd)}</li>
            <li>Liquidity: {fmtUsd(card.market.liquidityUsd)}</li>
            <li>24h Volume: {fmtUsd(card.market.volume24hUsd)}</li>
          </ul>
        </div>

        <div>
          <div className="text-xs uppercase tracking-wide text-kira-text-muted mb-2">Social</div>
          <ul className="space-y-1 text-xs text-kira-text-muted">
            <li>
              KOL mentions: {card.socialSignals.kolMentions} of {card.socialSignals.totalTrackedChannels} channels
            </li>
            <li>DexScreener trending: {card.socialSignals.trending ? "Yes" : "No"}</li>
          </ul>
        </div>
      </div>

      <div>
        <div className="text-xs uppercase tracking-wide text-kira-text-muted mb-2">Verdict (AI)</div>
        <p className="text-sm text-kira-text-muted leading-relaxed">{card.verdictText}</p>
      </div>
    </div>
  );
}
