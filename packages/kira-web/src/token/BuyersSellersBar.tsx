interface BuyersSellersBarProps {
  buys24h: number | null;
  sells24h: number | null;
  buyVolume24hUsd: number | null;
  sellVolume24hUsd: number | null;
}

function formatUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

export default function BuyersSellersBar({ buys24h, sells24h, buyVolume24hUsd, sellVolume24hUsd }: BuyersSellersBarProps) {
  if (buys24h == null || sells24h == null) {
    return null;
  }

  const total = buys24h + sells24h;
  const buyPct = total > 0 ? (buys24h / total) * 100 : 50;

  return (
    <div className="bg-kira-surface border border-kira-border rounded-md p-4">
      <div className="flex items-center justify-between text-xs text-kira-text-muted mb-2">
        <span>
          Buyers <span className="text-kira-green font-medium">{buys24h.toLocaleString("en-US")}</span>
        </span>
        <span>
          Sellers <span className="text-kira-red font-medium">{sells24h.toLocaleString("en-US")}</span>
        </span>
      </div>
      <div className="h-2 w-full rounded-full overflow-hidden bg-kira-surface-2 flex">
        <div className="h-full bg-kira-green" style={{ width: `${buyPct}%` }} />
        <div className="h-full bg-kira-red" style={{ width: `${100 - buyPct}%` }} />
      </div>
      {buyVolume24hUsd != null && sellVolume24hUsd != null && (
        <div className="flex items-center justify-between text-xs text-kira-text-dim mt-2">
          <span>Buy Vol {formatUsd(buyVolume24hUsd)}</span>
          <span>Sell Vol {formatUsd(sellVolume24hUsd)}</span>
        </div>
      )}
    </div>
  );
}
