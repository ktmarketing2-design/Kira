interface DexToolsChartProps {
  tokenAddress: string;
  pairAddress: string | null;
}

/**
 * Primary chart tab: DEXTools' embeddable widget via iframe. No build cost, full professional
 * chart (drawing tools, indicators) without maintaining any of that ourselves. Requires a real
 * DEX pool address, so pre-graduation bonding-curve tokens (no pairAddress yet) fall back to a
 * message + a Pump.fun link instead of an empty/broken iframe.
 */
export default function DexToolsChart({ tokenAddress, pairAddress }: DexToolsChartProps) {
  if (!pairAddress) {
    return (
      <div className="bg-kira-surface border border-kira-border rounded-md p-3">
        <div className="flex flex-col items-center justify-center text-center py-24 gap-3">
          <p className="text-kira-text-muted text-sm">Chart available after token graduates to a DEX</p>
          <a
            href={`https://pump.fun/coin/${tokenAddress}`}
            target="_blank"
            rel="noreferrer"
            className="text-kira-accent text-sm hover:underline"
          >
            View on Pump.fun ↗
          </a>
        </div>
      </div>
    );
  }

  const src = `https://www.dextools.io/widget-chart/en/solana/pe-dark/${pairAddress}?theme=dark&chartType=2&chartResolution=30&drawingToolbars=true`;

  return (
    <div className="bg-kira-surface border border-kira-border rounded-md p-3">
      <div className="w-full" style={{ height: 500 }}>
        <iframe
          src={src}
          title="DEXTools chart"
          className="w-full h-full rounded border-0"
          style={{ overflow: "hidden" }}
          scrolling="no"
          allow="clipboard-write"
        />
      </div>
    </div>
  );
}
