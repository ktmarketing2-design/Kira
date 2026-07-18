import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
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
  onRefresh,
}: {
  card: DdCard;
  address: string;
  events: ChartEvent[];
  onRefresh: () => void;
}) {
  const [buyModalOpen, setBuyModalOpen] = useState(false);
  const [holdersOpen, setHoldersOpen] = useState(false);
  const [kolOpen, setKolOpen] = useState(false);
  const [socialOpen, setSocialOpen] = useState(false);
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
          <span>HolderScan ({card.topHolders.length})</span>
          <span>{holdersOpen ? "▾" : "›"}</span>
        </div>
        {holdersOpen && (
          <div className="border-t border-tt-border">
            {card.topHolders.slice(0, 10).map((h) => (
              <div key={h.address} className="flex justify-between px-4 py-2 border-b border-tt-border text-xs">
                <span className="text-tt-fg-dim font-body">{truncate(h.address)}</span>
                <span className={h.isDev ? "text-tt-amber" : "text-tt-fg-dim"}>
                  {h.pct != null ? `${h.pct.toFixed(2)}%` : "—"}
                  {h.isDev ? " (dev)" : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* KOL Call History */}
      <div>
        <div
          onClick={() => setKolOpen((o) => !o)}
          className="flex justify-between px-4 py-3 text-xs text-tt-fg-dim cursor-pointer hover:text-tt-fg"
        >
          <span>KOL Call History</span>
          <span>{kolOpen ? "▾" : "›"}</span>
        </div>
        {kolOpen && (
          <div className="border-t border-tt-border px-4 py-3">
            <p className="text-xs text-tt-fg-faint mb-2">
              KOL mentions: {card.socialSignals.kolMentions} of {card.socialSignals.totalTrackedChannels} tracked channels
            </p>
            <a
              href="/kol"
              className="text-xs text-tt-brand hover:underline"
            >
              View full KOL call history →
            </a>
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
    </div>
  );
}

export default function TokenPage() {
  const { address } = useParams<{ address: string }>();
  const navigate = useNavigate();
  const [card, setCard] = useState<DdCard | null>(null);
  const [fullData, setFullData] = useState<TokenFullResponse | null>(null);
  const [events, setEvents] = useState<ChartEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [chartMode, setChartMode] = useState<ChartMode>("gecko");
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
    if (!address) return;
    let cancelled = false;
    apiRequest<TokenFullResponse>("GET", `/token/${address}/full`)
      .then((res) => {
        if (!cancelled) setFullData(res);
      })
      .catch(() => {
        if (!cancelled) setFullData(null);
      });

    apiRequest<{ alerts: ChartEvent[] }>("GET", `/token/${address}/events`)
      .then((res) => {
        if (!cancelled) setEvents(res.alerts.filter((a) => a.kind.startsWith("cluster")));
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
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
        // Desktop: two columns, left 65% chart + sub-tabs, right 35% scrollable sidebar.
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
            <TokenSidebar card={card} address={address} events={events} onRefresh={() => load(address)} />
          </div>
        </div>
      ) : (
        // Mobile: single column, chart first, then sub-tabs, then DD card.
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
            <TokenSidebar card={card} address={address} events={events} onRefresh={() => load(address)} />
          </div>
        </div>
      ))}

      <WalletProfileSlideOver address={profileAddress} onClose={() => setProfileAddress(null)} />
    </div>
  );
}
