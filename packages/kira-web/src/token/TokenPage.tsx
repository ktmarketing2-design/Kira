import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiRequest, ApiError } from "../lib/api.js";
import DdCardView from "../shell/DdCardView.js";
import GeckoTerminalChart from "./GeckoTerminalChart.js";
import SignalsChart from "./SignalsChart.js";
import TransactionsPanel from "./TransactionsPanel.js";
import BuyersSellersBar from "./BuyersSellersBar.js";
import HoldersPanel from "./HoldersPanel.js";
import SmartMoneyPanel from "./SmartMoneyPanel.js";
import type { DdCard } from "../lib/types.js";

const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

type ChartMode = "gecko" | "signals";

type SubTab = "transactions" | "holders" | "smartMoney";
const SUB_TABS: Array<{ id: SubTab; label: string }> = [
  { id: "transactions", label: "📋 Transactions" },
  { id: "holders", label: "👥 Holders" },
  { id: "smartMoney", label: "🧠 Smart Money" },
];

function buyUrl(card: DdCard): string {
  return card.graduated
    ? `https://jup.ag/swap/SOL-${card.tokenAddress}`
    : `https://pump.fun/coin/${card.tokenAddress}`;
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
          className={`text-xs px-2 py-1 rounded border ${
            chartMode === "gecko" ? "border-kira-accent text-kira-accent" : "border-kira-border text-kira-text-muted"
          }`}
        >
          📊 Chart
        </button>
        <button
          onClick={() => setChartMode("signals")}
          title="Shows cluster alerts, signal filter matches, and KOL calls for this token on a price chart."
          className={`text-xs px-2 py-1 rounded border ${
            chartMode === "signals" ? "border-kira-accent text-kira-accent" : "border-kira-border text-kira-text-muted"
          }`}
        >
          🎯 Kira Signals
        </button>
      </div>
      {chartMode === "gecko" ? (
        <GeckoTerminalChart tokenAddress={address} pairAddress={card.market.pairAddress} />
      ) : (
        <SignalsChart tokenAddress={address} pairAddress={card.market.pairAddress} />
      )}
    </div>
  );
}

function TokenSubTabs({ address, card, subTab, setSubTab }: {
  address: string;
  card: DdCard;
  subTab: SubTab;
  setSubTab: (t: SubTab) => void;
}) {
  return (
    <div className="mt-4">
      <div className="flex gap-1 mb-3 border-b border-kira-border">
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={`text-sm px-3 py-2 border-b-2 -mb-px ${
              subTab === t.id
                ? "border-kira-accent text-kira-accent"
                : "border-transparent text-kira-text-muted hover:text-kira-text"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subTab === "transactions" && (
        <div className="space-y-4">
          <BuyersSellersBar
            buys24h={card.market.buys24h}
            sells24h={card.market.sells24h}
            buyVolume24hUsd={card.market.buyVolume24hUsd}
            sellVolume24hUsd={card.market.sellVolume24hUsd}
          />
          <TransactionsPanel tokenAddress={address} />
        </div>
      )}
      {subTab === "holders" && <HoldersPanel holders={card.topHolders} top10HolderPct={card.safety.top10HolderPct} />}
      {subTab === "smartMoney" && <SmartMoneyPanel tokenAddress={address} />}
    </div>
  );
}

function TokenSidebar({ card, address, onRefresh }: { card: DdCard; address: string; onRefresh: () => void }) {
  return (
    <div className="space-y-3">
      <DdCardView card={card} />
      <div className="flex gap-3">
        <a
          href={buyUrl(card)}
          target="_blank"
          rel="noreferrer"
          className="flex-1 text-center bg-kira-accent text-kira-bg rounded px-3 py-2 text-sm font-medium hover:opacity-90"
        >
          💰 Buy Token
        </a>
        <button
          onClick={onRefresh}
          className="text-sm bg-kira-surface-2 border border-kira-border text-kira-text rounded px-3 py-2 hover:border-kira-accent"
        >
          Refresh DD
        </button>
      </div>
      {!card.graduated && (
        <p className="text-xs text-kira-text-dim">
          Pre-graduation token — Buy Token opens Pump.fun. Jupiter needs a live DEX pool.
        </p>
      )}
      <p className="text-xs text-kira-text-dim font-data truncate" title={address}>
        {address}
      </p>
    </div>
  );
}

export default function TokenPage() {
  const { address } = useParams<{ address: string }>();
  const navigate = useNavigate();
  const [card, setCard] = useState<DdCard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [chartMode, setChartMode] = useState<ChartMode>("gecko");
  const [subTab, setSubTab] = useState<SubTab>("transactions");

  function load(addr: string) {
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
        <h1 className="font-display text-lg text-kira-text mb-4">Token Search</h1>
        <form onSubmit={handleSearch} className="flex gap-2 max-w-lg">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Solana token address"
            className="flex-1 bg-kira-surface-2 border border-kira-border rounded px-3 py-2 text-xs font-data text-kira-text placeholder:text-kira-text-dim focus:outline-none focus:border-kira-accent"
          />
          <button type="submit" className="bg-kira-accent text-kira-bg rounded px-4 py-2 text-sm font-medium">
            Search
          </button>
        </form>
        {error && <p className="text-xs text-kira-red mt-2">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      {loading && <div className="text-kira-text-muted text-sm mb-4">Generating Deep Dive...</div>}
      {error && <div className="text-kira-red text-sm mb-4">{error}</div>}
      {card && (
        <>
          {/* Mobile: single column, chart first, then sub-tabs, then DD card. */}
          <div className="lg:hidden">
            <TokenChart address={address} card={card} chartMode={chartMode} setChartMode={setChartMode} />
            <TokenSubTabs address={address} card={card} subTab={subTab} setSubTab={setSubTab} />
            <div className="mt-6">
              <TokenSidebar card={card} address={address} onRefresh={() => load(address)} />
            </div>
          </div>

          {/* Desktop: two columns, left 65% chart + sub-tabs, right 35% scrollable sidebar. */}
          <div className="hidden lg:grid lg:grid-cols-[65fr_35fr] lg:gap-6 lg:items-start">
            <div>
              <TokenChart address={address} card={card} chartMode={chartMode} setChartMode={setChartMode} />
              <TokenSubTabs address={address} card={card} subTab={subTab} setSubTab={setSubTab} />
            </div>
            <div className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
              <TokenSidebar card={card} address={address} onRefresh={() => load(address)} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
