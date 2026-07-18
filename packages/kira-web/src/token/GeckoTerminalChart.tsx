interface GeckoTerminalChartProps {
  tokenAddress: string;
  pairAddress: string | null;
}

/**
 * Primary chart tab: GeckoTerminal's embeddable widget via iframe. Replaces an earlier DEXTools
 * embed that showed the wrong token — DEXTools uses its own internal pair ID format, not a raw
 * Solana pool address, so DexScreener's pairAddress (what the DD card actually has) resolved to
 * the wrong chart there. GeckoTerminal's embed takes the on-chain pool address directly, no
 * conversion or extra API call needed, and GeckoTerminal is already a data source elsewhere in
 * Kira. Requires a real DEX pool address, so pre-graduation bonding-curve tokens (no pairAddress
 * yet) fall back to a message + a Pump.fun link instead of an empty/broken iframe.
 */
export default function GeckoTerminalChart({ tokenAddress, pairAddress }: GeckoTerminalChartProps) {
  if (!pairAddress) {
    return (
      <div className="bg-tt-bg-raised border border-tt-border rounded-md p-3">
        <div className="flex flex-col items-center justify-center text-center py-24 gap-3">
          <p className="text-tt-fg-dim text-sm">Chart available after token graduates to a DEX</p>
          <a
            href={`https://pump.fun/coin/${tokenAddress}`}
            target="_blank"
            rel="noreferrer"
            className="text-tt-brand text-sm hover:underline"
          >
            View on Pump.fun ↗
          </a>
        </div>
      </div>
    );
  }

  const src = `https://www.geckoterminal.com/solana/pools/${pairAddress}?embed=1&info=0&swaps=0&grayscale=0&light_chart=0`;

  return (
    <div className="bg-tt-bg-raised border border-tt-border rounded-md p-3">
      <div className="w-full" style={{ height: 500 }}>
        <iframe
          src={src}
          title="GeckoTerminal chart"
          className="w-full h-full rounded-md border-0"
          style={{ overflow: "hidden" }}
          scrolling="no"
          allow="clipboard-write"
        />
      </div>
    </div>
  );
}
