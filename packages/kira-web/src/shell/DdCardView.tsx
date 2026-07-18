import type { DdCard } from "../lib/types.js";

function fmtUsd(value: number | null): string {
  if (value == null) return "—";
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function StatusMark({ ok }: { ok: boolean }) {
  return <span className={ok ? "text-tt-green" : "text-tt-amber"}>{ok ? "✓" : "⚠"}</span>;
}

export default function DdCardView({ card }: { card: DdCard }) {
  const symbol = card.symbol ?? "Token";

  return (
    <div className="bg-tt-bg-raised border border-tt-border rounded-md divide-y divide-tt-border">
      <div className="p-4">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="font-display text-lg text-tt-green">${symbol}</span>
          {card.name && <span className="text-tt-fg-dim text-xs">{card.name}</span>}
        </div>
        <div className="flex items-center gap-2 mt-1.5">
          <span className="font-body text-[10px] text-tt-fg-faint break-all">{card.tokenAddress}</span>
          <button
            onClick={() => void navigator.clipboard.writeText(card.tokenAddress)}
            className="text-[10px] text-tt-green hover:underline shrink-0"
          >
            Copy
          </button>
        </div>
        <div className="flex items-center gap-2 mt-2 text-[10px]">
          <span className="border border-tt-border rounded-md px-2 py-0.5 text-tt-fg-dim">Solana</span>
          {card.statusLabel && <span className="text-tt-amber whitespace-pre-line">{card.statusLabel}</span>}
        </div>
      </div>

      <div className="p-4">
        <div className="flex justify-between items-baseline mb-3">
          <span className="font-display text-xl text-tt-green">{card.safety.rugScore}/100</span>
          <span className="text-[10px] text-tt-fg-faint uppercase tracking-wide">Rug Score</span>
        </div>
        <ul>
          <li className="text-xs py-1 border-t border-tt-border flex gap-1.5">
            <StatusMark ok={card.safety.mintAuthorityRevoked} /> Mint revoked
          </li>
          <li className="text-xs py-1 border-t border-tt-border flex gap-1.5">
            <StatusMark ok={card.safety.freezeAuthorityRevoked} /> Freeze revoked
          </li>
          <li className="text-xs py-1 border-t border-tt-border flex gap-1.5">
            <StatusMark ok={card.safety.lpLocked} /> LP locked
          </li>
          <li className="text-xs py-1 border-t border-tt-border flex gap-1.5">
            <StatusMark ok={card.safety.honeypotClean} /> Not honeypot
          </li>
          {card.safety.top10HolderPct != null && (
            <li className="text-xs py-1 border-t border-tt-border text-tt-fg-dim">
              Top 10: {card.safety.top10HolderPct.toFixed(1)}% supply
            </li>
          )}
        </ul>
      </div>

      {card.volume && (
        <div className="p-4">
          <div className="flex justify-between items-baseline mb-3">
            <span className={`font-display text-xl ${card.volume.verdict === "organic" ? "text-tt-green" : "text-tt-amber"}`}>
              {card.volume.score}/100
            </span>
            <span className="text-[10px] text-tt-fg-faint uppercase tracking-wide">Vol Score ({card.volume.verdict})</span>
          </div>
          <ul>
            {card.volume.signals.map((s) => {
              const METRIC_LABELS: Record<string, string> = {
                vol_liq_ratio: "Vol/liq ratio",
                wallet_diversity: "Wallet diversity",
                timing_entropy: "Timing entropy",
                new_wallet_ratio: "New wallet ratio",
                fdv_liq_ratio: "FDV/liq ratio",
                round_size_prevalence: "Round size prevalence",
              };
              return (
                <li
                  key={s.name}
                  className={`text-xs py-1 border-t border-tt-border flex justify-between ${s.flag ? "text-tt-amber" : "text-tt-fg-dim"}`}
                >
                  <span>{METRIC_LABELS[s.name] ?? s.name.replace(/_/g, " ")}</span>
                  <span>{s.value.toFixed(2)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="p-4">
        <div className="text-[10px] uppercase tracking-wide text-tt-fg-faint mb-2.5">Market</div>
        <div className="flex justify-between text-xs py-1 text-tt-fg-dim font-body">
          <span>FDV</span>
          <span className="text-tt-fg">{fmtUsd(card.market.fdvUsd)}</span>
        </div>
        <div className="flex justify-between text-xs py-1 text-tt-fg-dim font-body">
          <span>Liquidity</span>
          <span className="text-tt-fg">{fmtUsd(card.market.liquidityUsd)}</span>
        </div>
        <div className="flex justify-between text-xs py-1 text-tt-fg-dim font-body">
          <span>24h Volume</span>
          <span className="text-tt-fg">{fmtUsd(card.market.volume24hUsd)}</span>
        </div>
      </div>

      <div className="p-4">
        <div className="text-[10px] uppercase tracking-wide text-tt-fg-faint mb-2.5">Social</div>
        <div className="flex justify-between text-xs py-1 text-tt-fg-dim">
          <span>KOL mentions</span>
          <span className="text-tt-fg">
            {card.socialSignals.kolMentions} of {card.socialSignals.totalTrackedChannels}
          </span>
        </div>
        <div className="flex justify-between text-xs py-1 text-tt-fg-dim">
          <span>DexScreener trending</span>
          <span className="text-tt-fg">{card.socialSignals.trending ? "Yes" : "No"}</span>
        </div>
      </div>

      {card.deepIntel && (
        <div className="p-4">
          <div className="text-[10px] uppercase tracking-wide text-tt-fg-faint mb-2.5">Deep Intel (GMGN)</div>
          <ul className="space-y-1 text-xs">
            <li className={(card.deepIntel.smartDegenCount ?? 0) > 3 ? "text-tt-green" : "text-tt-fg-dim"}>
              Smart Money: {card.deepIntel.smartDegenCount ?? "—"}
              {card.deepIntel.smartDegenCountCapped ? "+" : ""} wallets
            </li>
            <li className={(card.deepIntel.renownedWallets ?? 0) > 2 ? "text-tt-green" : "text-tt-fg-dim"}>
              KOL holders: {card.deepIntel.renownedWallets ?? "—"}
              {card.deepIntel.renownedWalletsCapped ? "+" : ""}
            </li>
            {card.deepIntel.ratTraderSamplePct != null && (
              <li className={card.deepIntel.ratTraderSamplePct > 30 ? "text-tt-red" : "text-tt-fg-dim"}>
                Rat traders: {card.deepIntel.ratTraderSamplePct.toFixed(0)}% of sample
              </li>
            )}
            {card.deepIntel.bundlerSamplePct != null && (
              <li className={card.deepIntel.bundlerSamplePct > 20 ? "text-tt-red" : "text-tt-fg-dim"}>
                Bundler bots: {card.deepIntel.bundlerSamplePct.toFixed(0)}% of sample
              </li>
            )}
            <li className="text-tt-fg-dim">
              Snipers: {card.deepIntel.sniperCount ?? "—"}
              {card.deepIntel.sniperCountCapped ? "+" : ""} at launch
            </li>
            {card.deepIntel.devHoldingPct != null && (
              <li className="text-tt-fg-dim">Dev holding: {card.deepIntel.devHoldingPct.toFixed(1)}%</li>
            )}
            {card.deepIntel.freshWalletSamplePct != null && (
              <li className="text-tt-fg-dim">Fresh wallets: {card.deepIntel.freshWalletSamplePct.toFixed(0)}% of sample</li>
            )}
          </ul>
        </div>
      )}

      <div className="p-4">
        <div className="text-[10px] uppercase tracking-wide text-tt-fg-faint mb-2">Verdict (AI)</div>
        <p className="text-xs text-tt-fg-dim leading-relaxed">{card.verdictText}</p>
      </div>
    </div>
  );
}
