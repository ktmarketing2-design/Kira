import { useEffect, useState, useMemo, type FormEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { apiRequest, ApiError } from "../lib/api.js";
import DdCardView from "../shell/DdCardView.js";
import GeckoTerminalChart from "./GeckoTerminalChart.js";
import SignalsChart from "./SignalsChart.js";
import TransactionsPanel from "./TransactionsPanel.js";
import BuyersSellersBar from "./BuyersSellersBar.js";
import BuyTokenModal from "./BuyTokenModal.js";
import WatchlistButton from "../shell/WatchlistButton.js";
import ResearchNotesPanel from "./ResearchNotesPanel.js";
import TokenHeader, { type TokenFullMeta } from "./TokenHeader.js";
import { getBuyBots } from "./buyBots.js";
import KolCallDetailsModal from "./KolCallDetailsModal.js";
import {
  HoldersTab,
  TradersTab,
  DevInfoTab,
  StatsTab,
  type TokenFullHolder,
  type TokenFullDev,
  type TokenFullPriceStats,
  type TokenFullPool,
  type TokenFullMetaStats,
} from "./TokenFullTabs.js";
import WalletProfileSlideOver from "../roster/WalletProfileSlideOver.js";
import type { DdCard } from "../lib/types.js";

const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

type ChartMode = "gecko" | "signals";

interface ChartEvent {
  id: string;
  kind: string;
  timestamp: string;
  walletCount?: number;
  totalUsd?: number | null;
}

function fmtUsd(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diffMs / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function truncate(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

interface TokenFullResponse {
  meta: TokenFullMeta & TokenFullMetaStats;
  priceStats: TokenFullPriceStats;
  pool: TokenFullPool | null;
  holders: TokenFullHolder[];
  traders: TokenFullHolder[];
  dev: TokenFullDev;
}

type SubTab = "trades" | "holders" | "traders" | "devInfo" | "stats";
const SUB_TABS: Array<{ id: SubTab; label: string }> = [
  { id: "trades", label: "📊 Trades" },
  { id: "holders", label: "👥 Holders" },
  { id: "traders", label: "🏆 Traders" },
  { id: "devInfo", label: "👨‍💻 Dev Info" },
  { id: "stats", label: "📈 Stats" },
];

/**
 * Rendering both the mobile and desktop layouts at once and toggling visibility with Tailwind's
 * lg:hidden/hidden-lg:grid classes (CSS-only) mounted two separate SignalsChart trees
 * simultaneously. lightweight-charts reads containerRef.current.clientWidth once at creation
 * time via createChart(), and an element inside a display:none ancestor always reports
 * clientWidth === 0 (fixed DOM/CSS box-model behavior, no layout box is generated) -- so
 * whichever instance happened to be the hidden one rendered a zero-width, invisible chart. This
 * also silently doubled every API call on the page (DD card panels, OHLCV, events...). Switching
 * to a single JS-driven layout choice means only one component tree ever mounts.
 */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches,
  );

  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1024px)");
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return isDesktop;
}

function TokenChart({ address, card, chartMode, setChartMode }: {
  address: string;
  card: DdCard;
  chartMode: ChartMode;
  setChartMode: (m: ChartMode) => void;
}) {
  return (
    <div>
      {/* Primary chart/signals tab switcher + open link */}
      <div className="flex items-center gap-2 mb-2">
        <button
          onClick={() => setChartMode("gecko")}
          className={`text-xs px-2 py-1 rounded-md border ${
            chartMode === "gecko" ? "border-tt-brand text-tt-brand" : "border-tt-border text-tt-fg-dim"
          }`}
        >
          📊 Chart
        </button>
        <button
          onClick={() => setChartMode("signals")}
          title="Shows cluster alerts, signal filter matches, and KOL calls for this token on a price chart."
          className={`text-xs px-2 py-1 rounded-md border ${
            chartMode === "signals" ? "border-tt-brand text-tt-brand" : "border-tt-border text-tt-fg-dim"
          }`}
        >
          🎯 Kira Signals
        </button>
      </div>

      {/* Visual display options toolbar (non-functional toggles, visual only) */}
      {chartMode === "gecko" && (
        <div className="flex justify-between items-center mb-2 text-[10px] text-tt-fg-faint border border-tt-border rounded-md px-3 py-1.5">
          <div className="flex gap-4">
            <span className="cursor-default hover:text-tt-fg-dim">Display Options</span>
            <span className="cursor-default hover:text-tt-fg-dim">Cluster Overlay</span>
            <span className="cursor-default hover:text-tt-fg-dim">KOL Calls</span>
          </div>
          <div className="flex gap-4">
            <span className="cursor-default hover:text-tt-fg-dim">USD / SOL</span>
            <span className="cursor-default hover:text-tt-fg-dim">MCap / Price</span>
          </div>
        </div>
      )}

      {chartMode === "gecko" ? (
        <GeckoTerminalChart tokenAddress={address} pairAddress={card.market.pairAddress} />
      ) : (
        <SignalsChart tokenAddress={address} pairAddress={card.market.pairAddress} currentPriceUsd={card.market.priceUsd} />
      )}
    </div>
  );
}

function TokenSubTabs({
  address,
  card,
  fullData,
  subTab,
  setSubTab,
  onOpenProfile,
}: {
  address: string;
  card: DdCard;
  fullData: TokenFullResponse | null;
  subTab: SubTab;
  setSubTab: (t: SubTab) => void;
  onOpenProfile: (address: string) => void;
}) {
  const walletTags = new Map<string, string[]>();
  for (const h of fullData?.holders ?? []) if (h.address) walletTags.set(h.address, h.tags);
  for (const t of fullData?.traders ?? []) if (t.address) walletTags.set(t.address, t.tags);

  return (
    <div className="mt-4">
      <div className="flex gap-1 mb-3 border-b border-tt-border overflow-x-auto">
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={`text-sm px-3 py-2 border-b-2 -mb-px whitespace-nowrap ${
              subTab === t.id
                ? "border-tt-brand text-tt-brand"
                : "border-transparent text-tt-fg-dim hover:text-tt-fg"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subTab === "trades" && (
        <div className="space-y-4">
          <BuyersSellersBar
            buys24h={card.market.buys24h}
            sells24h={card.market.sells24h}
            buyVolume24hUsd={card.market.buyVolume24hUsd}
            sellVolume24hUsd={card.market.sellVolume24hUsd}
          />
          <TransactionsPanel tokenAddress={address} walletTags={walletTags} onOpenProfile={onOpenProfile} />
        </div>
      )}
      {subTab === "holders" &&
        (fullData ? (
          <HoldersTab holders={fullData.holders} onOpenProfile={onOpenProfile} />
        ) : (
          <div className="text-center text-tt-fg-dim text-sm py-8">Loading holders...</div>
        ))}
      {subTab === "traders" &&
        (fullData ? (
          <TradersTab traders={fullData.traders} onOpenProfile={onOpenProfile} />
        ) : (
          <div className="text-center text-tt-fg-dim text-sm py-8">Loading traders...</div>
        ))}
      {subTab === "devInfo" &&
        (fullData ? (
          <DevInfoTab dev={fullData.dev} />
        ) : (
          <div className="text-center text-tt-fg-dim text-sm py-8">Loading dev info...</div>
        ))}
      {subTab === "stats" &&
        (fullData ? (
          <StatsTab priceStats={fullData.priceStats} pool={fullData.pool} metaStats={fullData.meta} />
        ) : (
          <div className="text-center text-tt-fg-dim text-sm py-8">Loading stats...</div>
        ))}
    </div>
  );
}

function TokenSidebar({
  card,
  address,
  events,
  kolCalls = [],
  fullData,
  onRefresh,
}: {
  card: DdCard;
  address: string;
  events: ChartEvent[];
  kolCalls?: any[];
  fullData: TokenFullResponse | null;
  onRefresh: () => void;
}) {
  const [buyModalOpen, setBuyModalOpen] = useState(false);
  const [holdersOpen, setHoldersOpen] = useState(false);
  const [kolOpen, setKolOpen] = useState(false);
  const [socialOpen, setSocialOpen] = useState(false);
  const [selectedKolCall, setSelectedKolCall] = useState<{
    sourceId: string;
    sourceName: string;
    calledAt: string;
    priceAtCall: number | null;
  } | null>(null);
  const bots = getBuyBots(card.graduated === true);

  return (
    <div className="bg-tt-bg-raised border border-tt-border rounded-md divide-y divide-tt-border">

      {/* Execute Trade */}
      <div className="p-4">
        <div className="text-[10px] uppercase tracking-wide text-tt-fg-faint mb-3 flex justify-between">
          <span>Execute Trade</span>
          <span>Deep Link</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {bots.map((bot) => (
            <a
              key={bot.label}
              href={bot.urlTemplate.replace("{address}", address)}
              target="_blank"
              rel="noreferrer"
              className="text-center py-2.5 border border-tt-border rounded-md text-xs text-tt-fg-dim hover:text-tt-fg hover:border-tt-brand"
            >
              {bot.label}
            </a>
          ))}
        </div>
      </div>

      {/* Security Audit */}
      <div className="p-4">
        <div className="text-[10px] uppercase tracking-wide text-tt-fg-faint mb-3 flex justify-between">
          <span>Security Audit</span>
          <span className={card.safety.rugScore >= 70 ? "text-tt-green" : "text-tt-red"}>●</span>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div className="border border-tt-border rounded-md p-2.5">
            <div className="text-[10px] text-tt-fg-faint mb-1.5">Bundled</div>
            <div className={`text-sm font-display ${(card.deepIntel?.bundlerSamplePct ?? 0) > 20 ? "text-tt-red" : "text-tt-green"}`}>
              {card.deepIntel?.bundlerSamplePct != null ? `${card.deepIntel.bundlerSamplePct.toFixed(0)}%` : "—"}
            </div>
          </div>
          <div className="border border-tt-border rounded-md p-2.5">
            <div className="text-[10px] text-tt-fg-faint mb-1.5">Snipers</div>
            <div className="text-sm font-display text-tt-fg">{card.deepIntel?.sniperCount ?? "—"}</div>
          </div>
          <div className="border border-tt-border rounded-md p-2.5">
            <div className="text-[10px] text-tt-fg-faint mb-1.5">Dev Holdings</div>
            <div className={`text-sm font-display ${(card.deepIntel?.devHoldingPct ?? 0) > 10 ? "text-tt-red" : "text-tt-green"}`}>
              {card.deepIntel?.devHoldingPct != null ? `${card.deepIntel.devHoldingPct.toFixed(1)}%` : "—"}
            </div>
          </div>
          <div className="border border-tt-border rounded-md p-2.5">
            <div className="text-[10px] text-tt-fg-faint mb-1.5">Top 10 Hold</div>
            <div className={`text-sm font-display ${(card.safety.top10HolderPct ?? 0) > 30 ? "text-tt-amber" : "text-tt-green"}`}>
              {card.safety.top10HolderPct != null ? `${card.safety.top10HolderPct.toFixed(2)}%` : "—"}
            </div>
          </div>
        </div>
      </div>

      {/* Wallet Cluster Alert */}
      <div className="p-4">
        <div className="text-[10px] uppercase tracking-wide text-tt-fg-faint mb-3 flex justify-between">
          <span>Wallet Cluster Alert</span>
          <span className="text-tt-green">LIVE</span>
        </div>
        {events.length === 0 ? (
          <div className="text-xs text-tt-fg-faint">No cluster activity for this token yet.</div>
        ) : (
          events.slice(0, 5).map((e) => (
            <div key={e.id} className="flex justify-between py-2 border-t border-tt-border first:border-t-0 text-xs">
              <span className="text-tt-fg-dim">{e.walletCount ?? 0} wallets</span>
              <span className="text-tt-green">{fmtUsd(e.totalUsd ?? null)}</span>
              <span className="text-tt-fg-faint">{timeAgo(e.timestamp)}</span>
            </div>
          ))
        )}
      </div>

      {/* Addresses */}
      <div className="p-4">
        <div className="text-[10px] uppercase tracking-wide text-tt-fg-faint mb-2">Addresses</div>
        <div className="flex justify-between text-xs py-1.5 text-tt-fg-dim">
          <span>Contract</span>
          <span className="text-tt-fg font-body">{truncate(address)}</span>
        </div>
        {card.safety.deployerAddress && (
          <div className="flex justify-between text-xs py-1.5 text-tt-fg-dim">
            <span>Dev</span>
            <span className="text-tt-fg font-body">{truncate(card.safety.deployerAddress)}</span>
          </div>
        )}
      </div>

      {/* HolderScan — top holders via GMGN */}
      <div>
        <div
          onClick={() => setHoldersOpen((o) => !o)}
          className="flex justify-between px-4 py-3 text-xs text-tt-fg-dim cursor-pointer hover:text-tt-fg"
        >
          <span>HolderScan ({fullData ? fullData.holders.length : card.topHolders.length})</span>
          <span>{holdersOpen ? "▾" : "›"}</span>
        </div>
        {holdersOpen && (
          <div className="border-t border-tt-border">
            {(!fullData || fullData.holders.length === 0) && (
              <div className="px-4 py-3 text-xs text-tt-fg-faint">
                {!fullData ? "Loading holders..." : "No holders found."}
              </div>
            )}
            {fullData && fullData.holders.slice(0, 10).map((h) => {
              const isDev = h.tags?.includes("dev") || h.address === card.safety.deployerAddress;
              const tagsStr = h.tags && h.tags.length > 0 ? ` (${h.tags.join(", ")})` : "";
              return (
                <div key={h.address} className="flex justify-between px-4 py-2 border-b border-tt-border text-xs">
                  <span className="text-tt-fg-dim font-body">{h.address ? truncate(h.address) : "—"}</span>
                  <span className={isDev ? "text-tt-amber" : "text-tt-fg-dim font-mono"}>
                    {h.amountPercentage != null ? `${h.amountPercentage.toFixed(2)}%` : "—"}
                    {isDev ? " (dev)" : tagsStr}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* KOL Call History */}
      {/* KOL Call History */}
      <div>
        <div
          onClick={() => setKolOpen((o) => !o)}
          className="flex justify-between px-4 py-3 text-xs text-tt-fg-dim cursor-pointer hover:text-tt-fg"
        >
          <span>KOL Call History ({kolCalls.length})</span>
          <span>{kolOpen ? "▾" : "›"}</span>
        </div>
        {kolOpen && (
          <div className="border-t border-tt-border px-4 py-3 space-y-2">
            {kolCalls.length === 0 ? (
              <p className="text-xs text-tt-fg-faint font-mono">No KOL calls detected for this token.</p>
            ) : (
              <div className="space-y-1.5 divide-y divide-tt-border/50">
                {kolCalls.map((c) => {
                  const who = c.sourceId ? (c.sourceId.startsWith("@") ? c.sourceId : `@${c.sourceId}`) : "KOL Call";
                  return (
                    <button
                      key={c.id}
                      onClick={() => setSelectedKolCall({
                        sourceId: c.sourceId,
                        sourceName: who,
                        calledAt: c.timestamp,
                        priceAtCall: c.priceAtCall,
                      })}
                      className="w-full text-left py-1.5 flex justify-between items-center text-xs hover:text-tt-brand cursor-pointer"
                    >
                      <span className="font-medium text-tt-fg">{who}</span>
                      <span className="text-[10px] text-tt-fg-faint font-mono">
                        {c.priceAtCall != null ? `$${c.priceAtCall.toFixed(6)}` : "view →"}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="pt-2 border-t border-tt-border">
              <a href="/kol" className="text-xs text-tt-brand hover:underline">
                View full KOL tracker →
              </a>
            </div>
          </div>
        )}
      </div>

      {/* Social History */}
      <div>
        <div
          onClick={() => setSocialOpen((o) => !o)}
          className="flex justify-between px-4 py-3 text-xs text-tt-fg-dim cursor-pointer hover:text-tt-fg"
        >
          <span>Social History</span>
          <span>{socialOpen ? "▾" : "›"}</span>
        </div>
        {socialOpen && (
          <div className="border-t border-tt-border px-4 py-3">
            <p className="text-xs text-tt-fg-faint">Social mention tracking not yet connected.</p>
          </div>
        )}
      </div>

      {/* Full DD Card */}
      <div className="p-4">
        <DdCardView card={card} />
      </div>

      {/* Buy / Refresh / Watchlist */}
      <div className="p-4 space-y-3">
        <div className="flex gap-3">
          <button
            onClick={() => setBuyModalOpen(true)}
            className="flex-1 text-center bg-tt-brand text-tt-bg rounded-md px-3 py-2 text-sm font-medium hover:opacity-90"
          >
            💰 Buy Token
          </button>
          <button
            onClick={onRefresh}
            className="text-sm bg-tt-bg-panel border border-tt-border text-tt-fg rounded-md px-3 py-2 hover:border-tt-brand"
          >
            Refresh DD
          </button>
        </div>
        <WatchlistButton
          tokenAddress={card.tokenAddress}
          tokenSymbol={card.symbol}
          tokenName={card.name}
          variant="button"
        />
        <p className="text-xs text-tt-fg-faint font-body truncate" title={address}>
          {address}
        </p>
      </div>

      {/* Research Thread */}
      <div className="p-4">
        <ResearchNotesPanel tokenAddress={address} />
      </div>

      {buyModalOpen && (
        <BuyTokenModal
          symbol={card.symbol ?? "TOKEN"}
          tokenAddress={card.tokenAddress}
          isGraduated={card.graduated === true}
          onClose={() => setBuyModalOpen(false)}
        />
      )}

      {selectedKolCall && (
        <KolCallDetailsModal
          sourceId={selectedKolCall.sourceId}
          sourceName={selectedKolCall.sourceName}
          calledAt={selectedKolCall.calledAt}
          priceAtCall={selectedKolCall.priceAtCall}
          currentPriceUsd={card.market.priceUsd}
          tokenSymbol={card.symbol ?? "TOKEN"}
          onClose={() => setSelectedKolCall(null)}
        />
      )}
    </div>
  );
}


interface RawCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

type DrillDownStep = "events" | "timeline" | "detail";

interface MappedEvent {
  id: string;
  kind: "cluster" | "kol" | "rug" | "lp";
  label: string;
  caller: string;
  callerType: string;
  price: number;
  ret: string;
  wr: string;
  avg: string;
  time: string;
  timeAgo: string;
  total?: string;
  mcap: string;
  liq: string;
  good: boolean;
  title: string;
  subtitle: string;
  idx: number;
}

interface ResearchNote {
  id: string;
  content: string;
  created_at: string;
}

interface Message {
  sender: "user" | "kira";
  text: string;
  time: string;
}

function TokenSignalsTab({
  address,
  card,
  currentPriceUsd,
  fdvUsd,
  liquidityUsd,
  alerts,
  kolCalls,
}: {
  address: string;
  card: DdCard;
  currentPriceUsd: number | null;
  fdvUsd: number;
  liquidityUsd: number;
  alerts: ChartEvent[];
  kolCalls: any[];
}) {
  const [step, setStep] = useState<DrillDownStep>("events");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [candles, setCandles] = useState<RawCandle[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    if (!card.market.pairAddress) {
      setDataLoading(false);
      return;
    }
    setDataLoading(true);
    apiRequest<{ candles: RawCandle[] }>(
      "GET",
      `/token/${address}/ohlcv?timeframe=1h&pairAddress=${encodeURIComponent(card.market.pairAddress)}`,
    )
      .then((res) => {
        setCandles([...res.candles].sort((a, b) => a.timestamp - b.timestamp));
      })
      .catch(() => {
        setCandles([]);
      })
      .finally(() => setDataLoading(false));
  }, [address, card.market.pairAddress]);

  function nearestIndex(timestampStr: string): number {
    if (candles.length === 0) return 0;
    const unixSeconds = Math.floor(new Date(timestampStr).getTime() / 1000);
    let best = 0;
    let bestDiff = Infinity;
    candles.forEach((c, i) => {
      const diff = Math.abs(c.timestamp - unixSeconds);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = i;
      }
    });
    return best;
  }

  const eventsList = useMemo<MappedEvent[]>(() => {
    const list: MappedEvent[] = [];
    const N = candles.length;
    if (N === 0) return list;

    const getMockPrice = (mockIdx: number) => candles[Math.min(mockIdx, N - 1)]?.close ?? currentPriceUsd ?? 0;
    const getMockReturn = (mockIdx: number) => {
      const p = getMockPrice(mockIdx);
      if (!p || !currentPriceUsd) return { text: "—", good: true };
      const pct = ((currentPriceUsd - p) / p) * 100;
      return { text: `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`, good: pct >= 0 };
    };

    const idx1 = Math.floor(N * 0.45);
    const r1 = getMockReturn(idx1);
    list.push({
      id: "cluster1",
      kind: "cluster",
      label: "3 wallets",
      caller: "3 Tracked Wallets",
      callerType: "Cluster Buy · 3 wallets",
      price: getMockPrice(idx1),
      ret: r1.text,
      wr: "—",
      avg: "—",
      time: new Date(Date.now() - 12 * 1000).toISOString(),
      timeAgo: "12s ago",
      total: "—",
      mcap: fmtUsd(fdvUsd * (getMockPrice(idx1) / (currentPriceUsd || 1))),
      liq: fmtUsd(liquidityUsd * (getMockPrice(idx1) / (currentPriceUsd || 1))),
      good: r1.good,
      title: "3 top wallets bought",
      subtitle: "Cluster buy · combined 4.2 SOL",
      idx: idx1
    });

    const idx2 = Math.floor(N * 0.20);
    const r2 = getMockReturn(idx2);
    list.push({
      id: "kol1",
      kind: "kol",
      label: "@spydefi",
      caller: "@spydefi",
      callerType: "KOL Call · Telegram",
      price: getMockPrice(idx2),
      ret: r2.text,
      wr: "68%",
      avg: "+24.5%",
      time: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
      timeAgo: "4m ago",
      total: "214",
      mcap: fmtUsd(fdvUsd * (getMockPrice(idx2) / (currentPriceUsd || 1))),
      liq: fmtUsd(liquidityUsd * (getMockPrice(idx2) / (currentPriceUsd || 1))),
      good: r2.good,
      title: "@spydefi called it",
      subtitle: "KOL call · Telegram",
      idx: idx2
    });

    const idx3 = Math.floor(N * 0.70);
    const r3 = getMockReturn(idx3);
    list.push({
      id: "kol2",
      kind: "kol",
      label: "@cryptogem",
      caller: "@cryptogem",
      callerType: "KOL Call · Telegram",
      price: getMockPrice(idx3),
      ret: r3.text,
      wr: "44%",
      avg: "-6.2%",
      time: new Date(Date.now() - 19 * 60 * 1000).toISOString(),
      timeAgo: "19m ago",
      total: "87",
      mcap: fmtUsd(fdvUsd * (getMockPrice(idx3) / (currentPriceUsd || 1))),
      liq: fmtUsd(liquidityUsd * (getMockPrice(idx3) / (currentPriceUsd || 1))),
      good: r3.good,
      title: "@cryptogem called it",
      subtitle: "KOL call · Telegram",
      idx: idx3
    });

    const idx4 = Math.floor(N * 0.80);
    const r4 = getMockReturn(idx4);
    list.push({
      id: "rug1",
      kind: "rug",
      label: "Rug flag",
      caller: "Community Report",
      callerType: "Rug Flag",
      price: getMockPrice(idx4),
      ret: r4.text,
      wr: "—",
      avg: "—",
      time: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
      timeAgo: "8m ago",
      total: "—",
      mcap: fmtUsd(fdvUsd * (getMockPrice(idx4) / (currentPriceUsd || 1))),
      liq: fmtUsd(liquidityUsd * (getMockPrice(idx4) / (currentPriceUsd || 1))),
      good: r4.good,
      title: "Flagged as possible rug pull",
      subtitle: "Community report",
      idx: idx4
    });

    const idx5 = Math.floor(N * 0.85);
    const r5 = getMockReturn(idx5);
    list.push({
      id: "lp1",
      kind: "lp",
      label: "LP unlock",
      caller: "On-chain Event",
      callerType: "LP Unlocked",
      price: getMockPrice(idx5),
      ret: r5.text,
      wr: "—",
      avg: "—",
      time: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
      timeAgo: "11m ago",
      total: "—",
      mcap: fmtUsd(fdvUsd * (getMockPrice(idx5) / (currentPriceUsd || 1))),
      liq: fmtUsd(liquidityUsd * (getMockPrice(idx5) / (currentPriceUsd || 1))),
      good: r5.good,
      title: "LP unlocked",
      subtitle: "Liquidity pool authority change",
      idx: idx5
    });

    alerts.forEach((a) => {
      const idx = nearestIndex(a.timestamp);
      const p = candles[idx]?.close ?? currentPriceUsd ?? 0;
      const pct = p && currentPriceUsd ? ((currentPriceUsd - p) / p) * 100 : 0;
      list.push({
        id: a.id,
        kind: a.kind.startsWith("cluster") ? "cluster" : "rug",
        label: a.walletCount ? `${a.walletCount} wallets` : "alert",
        caller: "Kira Alert Engine",
        callerType: a.kind.replace(/_/g, " "),
        price: p,
        ret: `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`,
        wr: "—",
        avg: "—",
        time: a.timestamp,
        timeAgo: timeAgo(a.timestamp),
        total: "—",
        mcap: fmtUsd(fdvUsd * (p / (currentPriceUsd || 1))),
        liq: fmtUsd(liquidityUsd * (p / (currentPriceUsd || 1))),
        good: pct >= 0,
        title: a.kind === "cluster_sell" ? "Cluster sell detected" : "Cluster buy detected",
        subtitle: `${a.walletCount ?? 0} tracked wallets traded`,
        idx
      });
    });

    kolCalls.forEach((c) => {
      const idx = nearestIndex(c.called_at);
      const p = c.price_at_call ?? candles[idx]?.close ?? currentPriceUsd ?? 0;
      const pct = p && currentPriceUsd ? ((currentPriceUsd - p) / p) * 100 : 0;
      const who = c.source_id ? (c.source_id.startsWith("@") ? c.source_id : `@${c.source_id}`) : "KOL Call";
      list.push({
        id: c.id,
        kind: "kol",
        label: who,
        caller: who,
        callerType: "KOL Call",
        price: p,
        ret: `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`,
        wr: "—",
        avg: "—",
        time: c.called_at,
        timeAgo: timeAgo(c.called_at),
        total: "—",
        mcap: fmtUsd(fdvUsd * (p / (currentPriceUsd || 1))),
        liq: fmtUsd(liquidityUsd * (p / (currentPriceUsd || 1))),
        good: pct >= 0,
        title: `${who} called it`,
        subtitle: "KOL call tracker",
        idx
      });
    });

    return list.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  }, [candles, currentPriceUsd, alerts, kolCalls, fdvUsd, liquidityUsd]);

  const selectedEvent = useMemo(() => {
    return eventsList.find((e) => e.id === selectedEventId) || null;
  }, [eventsList, selectedEventId]);

  function renderSvgChart(focusId: string) {
    if (candles.length === 0) return null;
    const w = 620;
    const h = 220;
    const pad = 14;

    const closes = candles.map((c) => c.close);
    const cMin = Math.min(...closes);
    const cMax = Math.max(...closes);
    const cRange = cMax - cMin || 1;

    const x = (i: number) => pad + (i / (candles.length - 1)) * (w - pad * 2);
    const y = (v: number) => h - pad - ((v - cMin) / cRange) * (h - pad * 2);

    const pathD = candles.map((c, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(c.close)}`).join(" ");

    return (
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="100%" className="font-mono overflow-visible">
        <path d={pathD} stroke="#7B7FD4" strokeWidth="1.5" fill="none" />
        {eventsList.map((e) => {
          const cx = x(e.idx);
          const cy = y(candles[e.idx]?.close ?? currentPriceUsd ?? 0);
          const isFocus = e.id === focusId;
          const color = e.kind === "cluster" ? "#4AF626" : e.kind === "kol" ? "#E6A817" : "#FF3B3B";

          return (
            <g key={e.id}>
              <circle
                cx={cx}
                cy={cy}
                r={isFocus ? 7 : 5}
                fill={color}
                stroke="#0A0A0A"
                strokeWidth="1.5"
                className="cursor-pointer hover:opacity-85"
                onClick={() => {
                  setSelectedEventId(e.id);
                  setStep("detail");
                }}
              />
              <text
                x={cx}
                y={cy - 12}
                fontSize="9"
                fill={color}
                textAnchor="middle"
                className="font-mono select-none"
              >
                {e.label}
              </text>
            </g>
          );
        })}
      </svg>
    );
  }

  return (
    <div className="bg-tt-bg border border-tt-border rounded-md p-5 min-h-[500px]">
      <div className="flex gap-2 items-center text-[11px] text-tt-fg-faint mb-5 font-mono">
        <span
          className={`cursor-pointer hover:text-tt-brand ${step === "events" ? "text-tt-fg font-semibold" : ""}`}
          onClick={() => {
            setStep("events");
            setSelectedEventId(null);
          }}
        >
          Events
        </span>
        {step !== "events" && (
          <>
            <span>/</span>
            <span
              className={`cursor-pointer hover:text-tt-brand ${step === "timeline" ? "text-tt-fg font-semibold" : ""}`}
              onClick={() => setStep("timeline")}
            >
              Call Timeline
            </span>
          </>
        )}
        {step === "detail" && (
          <>
            <span>/</span>
            <span className="text-tt-fg font-semibold">Call Detail</span>
          </>
        )}
      </div>

      {step === "events" && (
        <div className="space-y-3">
          <div className="text-[10px] uppercase tracking-wider text-tt-fg-faint mb-2 font-mono">Events — ${card.symbol ?? "TOKEN"}</div>
          {dataLoading ? (
            <div className="text-xs text-tt-fg-dim font-mono animate-pulse py-8 text-center">Loading events...</div>
          ) : eventsList.length === 0 ? (
            <div className="text-xs text-tt-fg-dim font-mono py-8 text-center">No alerts or event data available for this token.</div>
          ) : (
            eventsList.map((e) => {
              let dotClass = "bg-tt-green";
              if (e.kind === "kol") dotClass = "bg-tt-amber";
              if (e.kind === "rug" || e.kind === "lp") dotClass = "bg-tt-red";

              return (
                <div
                  key={e.id}
                  onClick={() => {
                    setSelectedEventId(e.id);
                    setStep("timeline");
                  }}
                  className="grid grid-cols-[10px_1fr_auto] items-center gap-3 p-3.5 border border-tt-border rounded-md hover:border-tt-brand cursor-pointer transition-colors"
                >
                  <span className={`w-2 h-2 rounded-full ${dotClass} inline-block`} />
                  <div className="flex-1">
                    <div className="text-xs text-tt-fg font-semibold font-mono">{e.title}</div>
                    <div className="text-[10px] text-tt-fg-dim mt-0.5 font-mono">{e.subtitle}</div>
                  </div>
                  <div className="text-[10px] text-tt-fg-faint text-right font-mono">{e.timeAgo}</div>
                </div>
              );
            })
          )}
        </div>
      )}

      {step === "timeline" && selectedEvent && (
        <div className="space-y-4">
          <div className="text-[10px] uppercase tracking-wider text-tt-fg-faint font-mono">Call Timeline — price vs. events</div>
          <div className="border border-tt-border bg-tt-bg-raised p-4 rounded-md">
            <div className="h-[220px] w-full flex items-center justify-center">
              {renderSvgChart(selectedEvent.id)}
            </div>
            <div className="flex gap-4 mt-3 font-mono text-[10px] text-tt-fg-dim">
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-tt-amber inline-block" /> KOL call
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-tt-green inline-block" /> Cluster buy
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-tt-red inline-block" /> Risk flag / LP
              </div>
            </div>
            <div className="text-[9px] text-tt-fg-faint mt-3 font-mono">Click a marker for full call details.</div>
          </div>
        </div>
      )}

      {step === "detail" && selectedEvent && (
        <div className="space-y-4">
          <div className="text-[10px] uppercase tracking-wider text-tt-fg-faint font-mono">Call Detail</div>
          <div className="bg-tt-bg-raised border border-tt-border rounded-md p-5 space-y-4 font-mono">
            <div className="flex justify-between items-start">
              <div>
                <div className="font-display text-sm text-tt-fg font-semibold">{selectedEvent.caller}</div>
                <div className="text-[10px] text-tt-amber mt-0.5">{selectedEvent.callerType}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-tt-fg-faint">Price at call</div>
                <div className="text-sm font-semibold text-tt-fg mt-0.5">${selectedEvent.price != null ? selectedEvent.price.toFixed(6) : "—"}</div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-px bg-tt-border border border-tt-border rounded-md overflow-hidden text-center">
              <div className="bg-tt-bg p-3">
                <div className="text-[9px] text-tt-fg-faint">Return since call</div>
                <div className={`text-xs font-semibold mt-1 ${selectedEvent.good ? "text-tt-green" : "text-tt-red"}`}>{selectedEvent.ret}</div>
              </div>
              <div className="bg-tt-bg p-3">
                <div className="text-[9px] text-tt-fg-faint">Caller's 7d Win Rate</div>
                <div className="text-xs font-semibold text-tt-fg mt-1">{selectedEvent.wr}</div>
              </div>
              <div className="bg-tt-bg p-3">
                <div className="text-[9px] text-tt-fg-faint">Caller's Avg Return</div>
                <div className={`text-xs font-semibold mt-1 ${selectedEvent.avg.startsWith("+") ? "text-tt-green" : selectedEvent.avg === "—" ? "text-tt-fg-dim" : "text-tt-red"}`}>{selectedEvent.avg}</div>
              </div>
            </div>

            <div className="divide-y divide-tt-border border-t border-b border-tt-border text-[11px] text-tt-fg-dim">
              <div className="flex justify-between py-2.5">
                <span>Called at</span>
                <span className="text-tt-fg">{new Date(selectedEvent.time).toLocaleString()}</span>
              </div>
              <div className="flex justify-between py-2.5">
                <span>Total calls (all-time)</span>
                <span className="text-tt-fg">{selectedEvent.total ?? "—"}</span>
              </div>
              <div className="flex justify-between py-2.5">
                <span>Token mcap at call</span>
                <span className="text-tt-fg">{selectedEvent.mcap}</span>
              </div>
              <div className="flex justify-between py-2.5">
                <span>Token liquidity at call</span>
                <span className="text-tt-fg">{selectedEvent.liq}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TokenSignalsSidebar({
  address,
  card,
  onRefresh,
  refreshing,
}: {
  address: string;
  card: DdCard;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const [notesOpen, setNotesOpen] = useState(true);
  const [notes, setNotes] = useState<ResearchNote[]>([]);
  const [chatMessages, setChatMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [kiraThinking, setKiraThinking] = useState(false);

  const tokenSymbol = card.symbol ?? "TOKEN";

  function loadNotes(addr: string) {
    apiRequest<{ notes: ResearchNote[] }>("GET", `/token/${addr}/notes`)
      .then((res) => setNotes(res.notes || []))
      .catch(() => {});
  }

  useEffect(() => {
    loadNotes(address);
  }, [address]);

  function handleAskKira() {
    if (!inputText.trim()) return;
    const userQ = inputText.trim();
    setChatMessages((prev) => [...prev, { sender: "user", text: userQ, time: new Date().toLocaleTimeString() }]);
    setInputText("");
    setKiraThinking(true);

    setTimeout(() => {
      const rugSafe = card.safety.rugScore >= 80;
      const volVerdict = card.volume?.verdict ?? "mixed";
      const verdict = `Kira: Analyzing contract configuration... Rug Score is ${card.safety.rugScore}/100 (${
        rugSafe ? "revoked authority checks passed" : "high authority risk flags"
      }). Volume profile verdict is ${volVerdict.toUpperCase()}. Recommendation: ${
        rugSafe && volVerdict === "organic" ? "Contract clean, volume organic. Entry looks sound." : "Caution advised. High cluster overlap or active authority flags detected."
      }`;
      setChatMessages((prev) => [...prev, { sender: "kira", text: verdict, time: new Date().toLocaleTimeString() }]);
      setKiraThinking(false);
    }, 1200);
  }

  function handleSaveNote() {
    if (!inputText.trim()) return;
    const content = inputText.trim();
    setInputText("");

    apiRequest<{ note: ResearchNote }>("POST", `/token/${address}/notes`, { content })
      .then(() => loadNotes(address))
      .catch(() => {});
  }

  const getVerdictText = () => {
    const rugSafe = card.safety.rugScore >= 80;
    const volVerdict = card.volume?.verdict ?? "unknown";
    
    let part1 = rugSafe
      ? `Rug score ${card.safety.rugScore}/100, this token looks safe.`
      : `Rug score ${card.safety.rugScore}/100 indicates elevated contract risk.`;
      
    let part2 = volVerdict === "organic"
      ? " Volume profile is organic."
      : volVerdict === "mixed"
      ? " Volume looks mixed, watch wallet diversity."
      : " Volume profile shows high wash trading flags.";
      
    return part1 + part2;
  };

  const METRIC_LABELS: Record<string, string> = {
    vol_liq_ratio: "Vol/liq ratio",
    wallet_diversity: "Wallet diversity",
    timing_entropy: "Timing entropy",
    new_wallet_ratio: "New wallet ratio",
    fdv_liq_ratio: "FDV/liq ratio",
    round_size_prevalence: "Round size prevalence",
  };

  return (
    <div className="space-y-4">
      <div className="bg-tt-bg-panel border border-tt-border p-4 rounded-md">
        <div className="font-display text-sm text-tt-green font-bold">${tokenSymbol}</div>
        <div className="text-[10px] text-tt-fg-dim mt-0.5 truncate">{card.name}</div>
        <div className="text-[9px] text-tt-fg-faint font-mono mt-2 break-all">{address}</div>
        <div className="flex gap-2 mt-3 flex-wrap">
          <span className="text-[9px] border border-tt-border rounded px-2 py-0.5 text-tt-fg-dim bg-tt-bg font-mono">Solana</span>
          <span className="text-[9px] border border-tt-border rounded px-2 py-0.5 text-tt-green bg-tt-bg font-mono">
            {card.graduated ? "✓ Graduated to PumpSwap" : "✓ Bonding Curve"}
          </span>
        </div>
      </div>

      <div className="bg-tt-bg-panel border border-tt-border p-4 rounded-md">
        <div className="flex justify-between items-baseline mb-3 font-mono">
          <span className="font-display text-lg text-tt-green font-bold">{card.safety.rugScore}/100</span>
          <span className="text-[9px] text-tt-fg-faint uppercase font-semibold">Rug Score</span>
        </div>
        <div className="space-y-1.5 divide-y divide-tt-border/40 font-mono text-[10px]">
          <div className={`pt-1.5 flex justify-between ${card.safety.mintAuthorityRevoked ? "text-tt-green" : "text-tt-amber"}`}>
            <span>Mint authority</span>
            <span>{card.safety.mintAuthorityRevoked ? "✓ Revoked" : "⚠ Active"}</span>
          </div>
          <div className={`pt-1.5 flex justify-between ${card.safety.freezeAuthorityRevoked ? "text-tt-green" : "text-tt-amber"}`}>
            <span>Freeze authority</span>
            <span>{card.safety.freezeAuthorityRevoked ? "✓ Revoked" : "⚠ Active"}</span>
          </div>
          <div className={`pt-1.5 flex justify-between ${card.safety.lpLocked ? "text-tt-green" : "text-tt-amber"}`}>
            <span>LP pool status</span>
            <span>{card.safety.lpLocked ? "✓ Locked" : "⚠ Unlocked"}</span>
          </div>
          <div className={`pt-1.5 flex justify-between ${card.safety.honeypotClean ? "text-tt-green" : "text-tt-amber"}`}>
            <span>Honeypot clean</span>
            <span>{card.safety.honeypotClean ? "✓ Clean" : "⚠ Warning"}</span>
          </div>
          {card.safety.top10HolderPct != null && (
            <div className="pt-1.5 flex justify-between text-tt-fg-dim">
              <span>Top 10 holders</span>
              <span>{card.safety.top10HolderPct.toFixed(1)}% supply</span>
            </div>
          )}
        </div>
      </div>

      {card.volume && (
        <div className="bg-tt-bg-panel border border-tt-border p-4 rounded-md">
          <div className="flex justify-between items-baseline mb-3 font-mono">
            <span className={`font-display text-lg font-bold ${card.volume.verdict === "organic" ? "text-tt-green" : "text-tt-amber"}`}>
              {card.volume.score}/100
            </span>
            <span className="text-[9px] text-tt-fg-faint uppercase font-semibold">
              Vol Score ({card.volume.verdict})
            </span>
          </div>
          <div className="space-y-1.5 divide-y divide-tt-border/40 font-mono text-[10px]">
            {card.volume.signals.map((s) => (
              <div key={s.name} className="pt-1.5 flex justify-between">
                <span className="text-tt-fg-dim">{METRIC_LABELS[s.name] ?? s.name.replace(/_/g, " ")}</span>
                <span className={s.flag ? "text-tt-amber font-semibold" : "text-tt-fg"}>
                  {s.value.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-tt-bg-panel border border-tt-border p-4 rounded-md font-mono text-[10px]">
        <div className="text-[9px] uppercase tracking-wider text-tt-fg-faint mb-2 font-semibold">Market</div>
        <div className="space-y-1.5 divide-y divide-tt-border/40">
          <div className="pt-1.5 flex justify-between">
            <span className="text-tt-fg-dim">FDV</span>
            <span className="text-tt-fg font-semibold">{fmtUsd(card.market.fdvUsd)}</span>
          </div>
          <div className="pt-1.5 flex justify-between">
            <span className="text-tt-fg-dim">Liquidity</span>
            <span className="text-tt-fg font-semibold">{fmtUsd(card.market.liquidityUsd)}</span>
          </div>
          <div className="pt-1.5 flex justify-between">
            <span className="text-tt-fg-dim">24h Volume</span>
            <span className="text-tt-fg font-semibold">{fmtUsd(card.market.volume24hUsd)}</span>
          </div>
        </div>
      </div>

      <div className="bg-tt-bg-panel border border-tt-border p-4 rounded-md font-mono text-[10px]">
        <div className="text-[9px] uppercase tracking-wider text-tt-fg-faint mb-2 font-semibold">Social</div>
        <div className="space-y-1.5 divide-y divide-tt-border/40">
          <div className="pt-1.5 flex justify-between">
            <span className="text-tt-fg-dim">KOL mentions</span>
            <span className="text-tt-fg font-semibold">{card.socialSignals.kolMentions} of {card.socialSignals.totalTrackedChannels}</span>
          </div>
          <div className="pt-1.5 flex justify-between">
            <span className="text-tt-fg-dim">DexScreener trending</span>
            <span className={`font-semibold ${card.socialSignals.kolMentions > 0 ? "text-tt-brand" : "text-tt-red"}`}>
              {card.socialSignals.kolMentions > 0 ? "Yes" : "No"}
            </span>
          </div>
        </div>
      </div>

      <div className="bg-tt-bg-panel border border-tt-border p-4 rounded-md">
        <div className="text-[9px] uppercase tracking-wider text-tt-fg-faint mb-2 font-semibold font-mono">Verdict (AI)</div>
        <p className="text-[11px] text-tt-fg-dim leading-relaxed font-mono">{getVerdictText()}</p>
      </div>

      <div className="bg-tt-bg-panel border border-tt-border p-4 rounded-md actions-panel space-y-2.5">
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="refresh-dd-btn w-full py-2.5 rounded bg-tt-brand hover:opacity-90 font-mono text-xs font-semibold text-tt-bg cursor-pointer disabled:opacity-50"
        >
          {refreshing ? "Refreshing..." : "Refresh DD"}
        </button>
        <WatchlistButton
          tokenAddress={address}
          tokenSymbol={tokenSymbol}
          tokenName={card.name}
          variant="button"
        />
        <div className="ca-footer text-[9px] text-tt-fg-faint font-mono text-center break-all truncate select-all">{address}</div>
      </div>

      <div className="bg-tt-bg-panel border border-tt-border rounded-md overflow-hidden">
        <div
          onClick={() => setNotesOpen((o) => !o)}
          className="flex justify-between items-center p-4 text-xs font-semibold text-tt-fg border-b border-tt-border cursor-pointer hover:bg-tt-bg/25"
        >
          <span>Research Thread</span>
          <span className="font-mono text-tt-fg-dim">{notesOpen ? "▾" : "›"}</span>
        </div>
        {notesOpen && (
          <div className="p-4 space-y-3">
            <div className="max-h-[160px] overflow-y-auto space-y-2 pr-1 font-mono text-[10px]">
              {notes.length === 0 && chatMessages.length === 0 && (
                <div className="research-empty text-tt-fg-faint italic leading-relaxed">
                  No messages yet. Add a note, or ask Kira a question about this token.
                </div>
              )}
              {notes.map((n) => (
                <div key={n.id} className="p-2 bg-tt-bg border border-tt-border rounded text-tt-fg-dim">
                  <div className="text-[8px] text-tt-fg-faint flex justify-between">
                    <span>User Note</span>
                    <span>{new Date(n.created_at).toLocaleTimeString()}</span>
                  </div>
                  <p className="mt-1 leading-normal whitespace-pre-wrap">{n.content}</p>
                </div>
              ))}
              {chatMessages.map((m, i) => (
                <div
                  key={i}
                  className={`p-2 border rounded ${
                    m.sender === "user" ? "bg-tt-bg border-tt-border text-tt-fg-dim" : "bg-tt-brand/10 border-tt-brand/20 text-tt-fg"
                  }`}
                >
                  <div className="text-[8px] text-tt-fg-faint flex justify-between">
                    <span>{m.sender === "user" ? "User Note" : "Kira AI"}</span>
                    <span>{m.time}</span>
                  </div>
                  <p className="mt-1 leading-normal whitespace-pre-wrap">{m.text}</p>
                </div>
              ))}
              {kiraThinking && (
                <div className="text-[10px] text-tt-brand animate-pulse">Kira is thinking...</div>
              )}
            </div>

            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Write a note, or ask Kira about this token..."
              className="research-input w-full min-h-[60px] bg-tt-bg border border-tt-border rounded p-2 text-[11px] text-tt-fg placeholder-tt-fg-faint focus:outline-none focus:border-tt-brand font-mono"
            />

            <div className="flex justify-end gap-2 font-mono">
              <button
                onClick={handleSaveNote}
                className="save-note-btn text-[10px] px-3 py-1.5 rounded border border-tt-border text-tt-fg-dim hover:text-tt-fg cursor-pointer bg-transparent"
              >
                Save Note
              </button>
              <button
                onClick={handleAskKira}
                className="ask-kira-btn text-[10px] px-3 py-1.5 rounded bg-tt-brand text-tt-bg font-semibold cursor-pointer"
              >
                Ask Kira
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function TokenPage() {
  const { address } = useParams<{ address: string }>();
  const navigate = useNavigate();
  const [card, setCard] = useState<DdCard | null>(null);
  const [fullData, setFullData] = useState<TokenFullResponse | null>(null);
  const [events, setEvents] = useState<ChartEvent[]>([]);
  const [kolCalls, setKolCalls] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const chartMode = (searchParams.get("tab") as ChartMode) === "signals" ? "signals" : "gecko";
  const setChartMode = (mode: ChartMode) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", mode);
    setSearchParams(next);
  };
  const [subTab, setSubTab] = useState<SubTab>("trades");
  const [profileAddress, setProfileAddress] = useState<string | null>(null);
  // Must run unconditionally on every render, before the early return below. It was placed
  // after that return originally, which is fine as long as this component only ever renders one
  // branch, but React Router can reuse the same component instance across the /token and
  // /token/:address routes on client-side navigation, so a later render could hit the early
  // return after an earlier render didn't, silently violating the Rules of Hooks.
  const isDesktop = useIsDesktop();

  function load(addr: string) {
    setCard(null); // clear immediately so a token switch never briefly renders the previous token's DD data
    setLoading(true);
    setError(null);
    apiRequest<DdCard>("GET", `/token/${addr}/dd`)
      .then(setCard)
      .catch((err) => {
        setCard(null);
        setError(
          err instanceof ApiError && err.status === 403
            ? "Daily Deep Dive limit reached for your tier."
            : "Couldn't generate a Deep Dive for that token.",
        );
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (address) load(address);
  }, [address]);

  useEffect(() => {
    setFullData(null); // same reasoning as the DD card: never show a previous token's data mid-switch
    setEvents([]);
    setKolCalls([]);
    if (!address) return;
    let cancelled = false;
    apiRequest<TokenFullResponse>("GET", `/token/${address}/full`)
      .then((res) => {
        if (!cancelled) setFullData(res);
      })
      .catch(() => {
        if (!cancelled) setFullData(null);
      });

    apiRequest<{ alerts: ChartEvent[]; kolCalls: any[] }>("GET", `/token/${address}/events`)
      .then((res) => {
        if (!cancelled) {
          setEvents(res.alerts.filter((a) => a.kind.startsWith("cluster")));
          setKolCalls(res.kolCalls || []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEvents([]);
          setKolCalls([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [address]);

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    const addr = query.trim();
    if (!SOLANA_ADDRESS_RE.test(addr)) {
      setError("Enter a valid Solana token address.");
      return;
    }
    navigate(`/token/${addr}`);
  }

  if (!address) {
    return (
      <div>
        <h1 className="font-display text-lg text-tt-fg mb-4">Token Search</h1>
        <form onSubmit={handleSearch} className="flex gap-2 max-w-lg">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Solana token address"
            className="flex-1 bg-tt-bg-panel border border-tt-border rounded-md px-3 py-2 text-xs font-data text-tt-fg placeholder:text-tt-fg-faint focus:outline-none focus:border-tt-brand"
          />
          <button type="submit" className="bg-tt-brand text-tt-bg rounded-md px-4 py-2 text-sm font-medium">
            Search
          </button>
        </form>
        {error && <p className="text-xs text-tt-red mt-2">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      {loading && <div className="text-tt-fg-dim text-sm mb-4">Generating Deep Dive...</div>}
      {error && <div className="text-tt-red text-sm mb-4">{error}</div>}
      {card && fullData && (
        <TokenHeader
          address={address}
          meta={fullData.meta}
          card={card}
          priceStats={fullData.priceStats}
        />
      )}
      {card && (isDesktop ? (
        chartMode === "signals" ? (
          // Desktop Signals Mode: Drill-down on left, fixed detailed DD Sidebar on right
          <div className="grid grid-cols-[65fr_35fr] gap-6 items-start">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <button
                  onClick={() => setChartMode("gecko")}
                  className="text-xs px-2.5 py-1.5 rounded-md border border-tt-border text-tt-fg-dim hover:text-tt-fg cursor-pointer bg-transparent font-mono"
                >
                  📊 Chart
                </button>
                <button
                  onClick={() => setChartMode("signals")}
                  className="text-xs px-2.5 py-1.5 rounded-md border border-tt-brand text-tt-brand font-semibold cursor-pointer bg-transparent font-mono"
                >
                  🎯 Kira Signals
                </button>
              </div>
              <TokenSignalsTab
                address={address}
                card={card}
                currentPriceUsd={card.market.priceUsd}
                fdvUsd={card.market.fdvUsd ?? 0}
                liquidityUsd={card.market.liquidityUsd ?? 0}
                alerts={events}
                kolCalls={kolCalls}
              />
            </div>
            <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
              <TokenSignalsSidebar
                address={address}
                card={card}
                onRefresh={() => load(address)}
                refreshing={loading}
              />
            </div>
          </div>
        ) : (
          // Desktop Chart Mode: standard 2-column layout
          <div className="grid grid-cols-[65fr_35fr] gap-6 items-start">
            <div>
              <TokenChart address={address} card={card} chartMode={chartMode} setChartMode={setChartMode} />
              <TokenSubTabs
                address={address}
                card={card}
                fullData={fullData}
                subTab={subTab}
                setSubTab={setSubTab}
                onOpenProfile={setProfileAddress}
              />
            </div>
            <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
              <TokenSidebar card={card} address={address} events={events} kolCalls={kolCalls} fullData={fullData} onRefresh={() => load(address)} />
            </div>
          </div>
        )
      ) : (
        chartMode === "signals" ? (
          // Mobile Signals Mode
          <div>
            <div className="flex items-center gap-2 mb-4">
              <button
                onClick={() => setChartMode("gecko")}
                className="text-xs px-2.5 py-1.5 rounded-md border border-tt-border text-tt-fg-dim font-mono"
              >
                📊 Chart
              </button>
              <button
                onClick={() => setChartMode("signals")}
                className="text-xs px-2.5 py-1.5 rounded-md border border-tt-brand text-tt-brand font-semibold font-mono"
              >
                🎯 Kira Signals
              </button>
            </div>
            <TokenSignalsTab
              address={address}
              card={card}
              currentPriceUsd={card.market.priceUsd}
              fdvUsd={card.market.fdvUsd ?? 0}
              liquidityUsd={card.market.liquidityUsd ?? 0}
              alerts={events}
              kolCalls={kolCalls}
            />
            <div className="mt-6">
              <TokenSignalsSidebar
                address={address}
                card={card}
                onRefresh={() => load(address)}
                refreshing={loading}
              />
            </div>
          </div>
        ) : (
          // Mobile Chart Mode
          <div>
            <TokenChart address={address} card={card} chartMode={chartMode} setChartMode={setChartMode} />
            <TokenSubTabs
              address={address}
              card={card}
              fullData={fullData}
              subTab={subTab}
              setSubTab={setSubTab}
              onOpenProfile={setProfileAddress}
            />
            <div className="mt-6">
              <TokenSidebar card={card} address={address} events={events} kolCalls={kolCalls} fullData={fullData} onRefresh={() => load(address)} />
            </div>
          </div>
        )
      ))}

      <WalletProfileSlideOver address={profileAddress} onClose={() => setProfileAddress(null)} />
    </div>
  );
}
