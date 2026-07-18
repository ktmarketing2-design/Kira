export interface TokenFullHolder {
  address: string | null;
  usdValue: number | null;
  amountPercentage: number | null;
  balance: number | null;
  costBasis: number | null;
  realizedProfit: number | null;
  unrealizedProfit: number | null;
  totalProfit: number | null;
  buyVolume: number | null;
  sellVolume: number | null;
  buyTxCount: number | null;
  sellTxCount: number | null;
  netflowUsd: number | null;
  walletTag: string | null;
  tags: string[];
}

export interface TokenFullDevHistoryEntry {
  address: string | null;
  symbol: string | null;
  logo: string | null;
  createdAt: number | null;
  isOpen: boolean | null;
  marketCap: number | null;
  athMarketCap: number | null;
  holders: number | null;
  liquidity: number | null;
  launchpad: string | null;
  isPump: boolean | null;
  bundlerRate: number | null;
}

export interface TokenFullDev {
  address: string | null;
  tokenBalance: number | null;
  tokenStatus: string | null;
  top10HolderRate: number | null;
  fundSource: string | null;
  fundSourceTimestamp: number | null;
  tokensCreated: number | null;
  history: {
    totalCreated: number | null;
    openCount: number | null;
    openRatio: number | null;
    athToken: { token_symbol?: string; token_name?: string; ath_mc?: number } | null;
    tokens: TokenFullDevHistoryEntry[];
  } | null;
}

export interface TokenFullPriceStats {
  current: number | null;
  change1m: number | null;
  change5m: number | null;
  change1h: number | null;
  change6h: number | null;
  change24h: number | null;
  buys1m: number | null;
  buys5m: number | null;
  buys1h: number | null;
  buys24h: number | null;
  sells1m: number | null;
  sells5m: number | null;
  sells1h: number | null;
  sells24h: number | null;
}

export interface TokenFullPool {
  exchange: string | null;
  liquidity: number | null;
  baseReserve: number | null;
  quoteReserve: number | null;
  initialLiquidity: number | null;
  feeRatio: number | null;
  createdAt: number | null;
  quoteSymbol: string | null;
}

export interface TokenFullMetaStats {
  athPrice: number | null;
  totalSupply: number | null;
  circulatingSupply: number | null;
  lockedRatio: number | null;
}

const TAG_LABELS: Record<string, string> = {
  smart_degen: "🧠",
  renowned: "🎤",
  rat_trader: "🐀",
  bundler: "🤖",
};

function truncate(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function fmtUsd(v: number | null): string {
  if (v == null) return "—";
  const sign = v >= 0 ? "" : "-";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function pnlClass(v: number | null): string {
  if (v == null) return "text-kira-text-muted";
  return v > 0 ? "text-kira-green" : v < 0 ? "text-kira-red" : "text-kira-text-muted";
}

function HolderTraderTable({
  rows,
  onOpenProfile,
}: {
  rows: TokenFullHolder[];
  onOpenProfile: (address: string) => void;
}) {
  if (rows.length === 0) {
    return <div className="text-center text-kira-text-muted text-sm py-8">No data available.</div>;
  }

  return (
    <div className="bg-kira-surface border border-kira-border rounded-md overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-kira-text-muted border-b border-kira-border">
            <th className="px-3 py-2 font-normal">#</th>
            <th className="px-3 py-2 font-normal">Wallet</th>
            <th className="px-3 py-2 font-normal text-right">% Supply</th>
            <th className="px-3 py-2 font-normal text-right">USD Value</th>
            <th className="px-3 py-2 font-normal text-right">Cost</th>
            <th className="px-3 py-2 font-normal text-right">PnL</th>
            <th className="px-3 py-2 font-normal">Tags</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((h, i) => (
            <tr
              key={h.address ?? i}
              className="border-b border-kira-border last:border-0 cursor-pointer hover:bg-kira-surface-2/50"
              onClick={() => h.address && onOpenProfile(h.address)}
            >
              <td className="px-3 py-2 text-kira-text-dim">{i + 1}</td>
              <td className="px-3 py-2 font-data text-xs text-kira-text">{h.address ? truncate(h.address) : "—"}</td>
              <td className="px-3 py-2 text-right font-data text-xs text-kira-text-muted">
                {h.amountPercentage != null ? `${(h.amountPercentage * 100).toFixed(2)}%` : "—"}
              </td>
              <td className="px-3 py-2 text-right font-data text-xs text-kira-text-muted">{fmtUsd(h.usdValue)}</td>
              <td className="px-3 py-2 text-right font-data text-xs text-kira-text-muted">{fmtUsd(h.costBasis)}</td>
              <td className={`px-3 py-2 text-right font-data text-xs ${pnlClass(h.realizedProfit)}`}>
                {h.realizedProfit != null ? fmtUsd(h.realizedProfit) : "—"}
              </td>
              <td className="px-3 py-2">
                {h.tags.map((tag) => (
                  <span key={tag} title={tag} className="mr-1">
                    {TAG_LABELS[tag] ?? tag}
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function HoldersTab({ holders, onOpenProfile }: { holders: TokenFullHolder[]; onOpenProfile: (a: string) => void }) {
  return <HolderTraderTable rows={holders} onOpenProfile={onOpenProfile} />;
}

export function TradersTab({ traders, onOpenProfile }: { traders: TokenFullHolder[]; onOpenProfile: (a: string) => void }) {
  return <HolderTraderTable rows={traders} onOpenProfile={onOpenProfile} />;
}

export function DevInfoTab({ dev }: { dev: TokenFullDev }) {
  if (!dev.address) {
    return <div className="text-center text-kira-text-muted text-sm py-8">No dev info available.</div>;
  }

  const isSerialRugger =
    dev.history != null && (dev.history.totalCreated ?? 0) > 3 && (dev.history.openRatio ?? 1) < 0.3;

  return (
    <div className="py-2 space-y-4">
      <div>
        <div className="text-xs text-kira-text-muted mb-1">DEV WALLET</div>
        <div className="flex items-center gap-2">
          <span className="font-data text-sm text-kira-text">{truncate(dev.address)}</span>
          <button
            onClick={() => navigator.clipboard.writeText(dev.address ?? "")}
            className="text-kira-accent text-xs hover:opacity-80"
          >
            ⎘
          </button>
          <a
            href={`https://gmgn.ai/sol/address/${dev.address}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-kira-text-muted hover:text-kira-text"
          >
            View on GMGN ↗
          </a>
        </div>
        {isSerialRugger && (
          <div className="mt-2 inline-block text-xs text-kira-red border border-kira-red/50 bg-kira-red/10 rounded px-2 py-1">
            ⚠️ Serial rugger — {((dev.history?.openRatio ?? 0) * 100).toFixed(0)}% open rate across{" "}
            {dev.history?.totalCreated} launches
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-kira-surface-2 rounded p-3">
          <div className="text-xs text-kira-text-muted mb-1">Tokens Created</div>
          <div className="text-sm font-medium text-kira-text">{dev.history?.totalCreated ?? dev.tokensCreated ?? "—"}</div>
        </div>
        <div className="bg-kira-surface-2 rounded p-3">
          <div className="text-xs text-kira-text-muted mb-1">Open Rate</div>
          <div className="text-sm font-medium text-kira-text">
            {dev.history?.openRatio != null ? `${(dev.history.openRatio * 100).toFixed(0)}%` : "—"}
          </div>
        </div>
        <div className="bg-kira-surface-2 rounded p-3">
          <div className="text-xs text-kira-text-muted mb-1">Fund Source</div>
          <div className="text-sm font-medium text-kira-text font-data">
            {dev.fundSource ? truncate(dev.fundSource) : "—"}
          </div>
        </div>
      </div>

      {dev.history?.athToken && (
        <div>
          <div className="text-xs text-kira-text-muted mb-2">BEST PROJECT (ATH)</div>
          <div className="bg-kira-surface-2 rounded p-3 text-sm">
            <span className="font-medium text-kira-text">${dev.history.athToken.token_symbol}</span>
            <span className="text-kira-text-muted ml-2">{dev.history.athToken.token_name}</span>
            <span className="text-kira-green ml-2">ATH {fmtUsd(dev.history.athToken.ath_mc ?? null)}</span>
          </div>
        </div>
      )}

      {dev.history && dev.history.tokens.length > 0 && (
        <div>
          <div className="text-xs text-kira-text-muted mb-2">PREVIOUS LAUNCHES</div>
          <div className="bg-kira-surface border border-kira-border rounded-md overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-kira-text-muted border-b border-kira-border">
                  <th className="px-3 py-2 font-normal">Token</th>
                  <th className="px-3 py-2 font-normal text-right">ATH MC</th>
                  <th className="px-3 py-2 font-normal text-right">Current MC</th>
                  <th className="px-3 py-2 font-normal text-right">Holders</th>
                  <th className="px-3 py-2 font-normal text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {dev.history.tokens.map((t) => (
                  <tr key={t.address} className="border-b border-kira-border last:border-0">
                    <td className="px-3 py-2 font-medium text-kira-text">${t.symbol ?? "?"}</td>
                    <td className="px-3 py-2 text-right text-kira-green font-data text-xs">{fmtUsd(t.athMarketCap)}</td>
                    <td className="px-3 py-2 text-right text-kira-text-muted font-data text-xs">{fmtUsd(t.marketCap)}</td>
                    <td className="px-3 py-2 text-right text-kira-text-muted font-data text-xs">
                      {t.holders?.toLocaleString() ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-center text-xs">
                      {t.isOpen ? (
                        <span className="text-kira-green">✅ Live</span>
                      ) : (
                        <span className="text-kira-red">💀 Dead</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function StatRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-kira-border last:border-0">
      <span className="text-xs text-kira-text-muted">{label}</span>
      <span className={`text-xs font-medium font-data ${color ?? "text-kira-text"}`}>{value}</span>
    </div>
  );
}

function fmtPct(v: number | null): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

export function StatsTab({
  priceStats,
  pool,
  metaStats,
}: {
  priceStats: TokenFullPriceStats;
  pool: TokenFullPool | null;
  metaStats: TokenFullMetaStats;
}) {
  return (
    <div className="py-2">
      <div className="text-xs text-kira-text-muted mb-1">PRICE CHANGES</div>
      <StatRow label="1 min" value={fmtPct(priceStats.change1m)} color={pnlClass(priceStats.change1m)} />
      <StatRow label="5 min" value={fmtPct(priceStats.change5m)} color={pnlClass(priceStats.change5m)} />
      <StatRow label="1 hour" value={fmtPct(priceStats.change1h)} color={pnlClass(priceStats.change1h)} />
      <StatRow label="6 hours" value={fmtPct(priceStats.change6h)} color={pnlClass(priceStats.change6h)} />
      <StatRow label="24 hours" value={fmtPct(priceStats.change24h)} color={pnlClass(priceStats.change24h)} />

      <div className="text-xs text-kira-text-muted mt-4 mb-1">BUYS / SELLS</div>
      <StatRow label="1 min" value={`${priceStats.buys1m ?? 0} / ${priceStats.sells1m ?? 0}`} />
      <StatRow label="5 min" value={`${priceStats.buys5m ?? 0} / ${priceStats.sells5m ?? 0}`} />
      <StatRow label="1 hour" value={`${priceStats.buys1h ?? 0} / ${priceStats.sells1h ?? 0}`} />
      <StatRow label="24 hours" value={`${priceStats.buys24h ?? 0} / ${priceStats.sells24h ?? 0}`} />

      <div className="text-xs text-kira-text-muted mt-4 mb-1">TOKEN INFO</div>
      <StatRow label="ATH Price" value={metaStats.athPrice != null ? `$${metaStats.athPrice.toFixed(8)}` : "—"} color="text-kira-green" />
      <StatRow label="Total Supply" value={metaStats.totalSupply != null ? metaStats.totalSupply.toLocaleString() : "—"} />
      <StatRow label="Circulating" value={metaStats.circulatingSupply != null ? metaStats.circulatingSupply.toLocaleString() : "—"} />
      <StatRow label="Locked Liquidity" value={metaStats.lockedRatio != null ? `${(metaStats.lockedRatio * 100).toFixed(1)}%` : "—"} />

      <div className="text-xs text-kira-text-muted mt-4 mb-1">POOL INFO</div>
      <StatRow label="Exchange" value={pool?.exchange ?? "—"} />
      <StatRow label="Pool Liquidity" value={fmtUsd(pool?.liquidity ?? null)} />
      <StatRow label="Base Reserve" value={pool?.baseReserve != null ? pool.baseReserve.toLocaleString() : "—"} />
      <StatRow
        label="Quote Reserve"
        value={pool?.quoteReserve != null ? `${pool.quoteReserve.toFixed(2)} ${pool.quoteSymbol ?? ""}` : "—"}
      />
      <StatRow label="Initial Liquidity" value={fmtUsd(pool?.initialLiquidity ?? null)} />
      <StatRow label="Fee" value={pool?.feeRatio != null ? `${(pool.feeRatio * 100).toFixed(2)}%` : "—"} />
      <StatRow
        label="Pool Created"
        value={pool?.createdAt != null ? new Date(pool.createdAt * 1000).toLocaleString() : "—"}
      />
    </div>
  );
}
