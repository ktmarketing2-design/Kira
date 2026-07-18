import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
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

function TokenSidebar({ card, address, onRefresh }: { card: DdCard; address: string; onRefresh: () => void }) {
  const [buyModalOpen, setBuyModalOpen] = useState(false);

  return (
    <div className="space-y-3">
      <DdCardView card={card} />
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
      <p className="text-xs text-tt-fg-faint font-data truncate" title={address}>
        {address}
      </p>

      <ResearchNotesPanel tokenAddress={address} />

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
    if (!address) return;
    let cancelled = false;
    apiRequest<TokenFullResponse>("GET", `/token/${address}/full`)
      .then((res) => {
        if (!cancelled) setFullData(res);
      })
      .catch(() => {
        if (!cancelled) setFullData(null);
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
      {card && fullData && <TokenHeader address={address} meta={fullData.meta} />}
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
            <TokenSidebar card={card} address={address} onRefresh={() => load(address)} />
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
            <TokenSidebar card={card} address={address} onRefresh={() => load(address)} />
          </div>
        </div>
      ))}

      <WalletProfileSlideOver address={profileAddress} onClose={() => setProfileAddress(null)} />
    </div>
  );
}
