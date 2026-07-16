import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiRequest, ApiError } from "../lib/api.js";
import DdCardView from "../shell/DdCardView.js";
import DexToolsChart from "./DexToolsChart.js";
import SignalsChart from "./SignalsChart.js";
import TransactionsPanel from "./TransactionsPanel.js";
import BuyersSellersBar from "./BuyersSellersBar.js";
import HoldersPanel from "./HoldersPanel.js";
import type { DdCard } from "../lib/types.js";

const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

type Tab = "chart" | "signals" | "transactions" | "holders";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "chart", label: "📊 Chart" },
  { id: "signals", label: "🎯 Signals" },
  { id: "transactions", label: "📋 Transactions" },
  { id: "holders", label: "👥 Holders" },
];

export default function TokenPage() {
  const { address } = useParams<{ address: string }>();
  const navigate = useNavigate();
  const [card, setCard] = useState<DdCard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("chart");

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
          <DdCardView card={card} />

          <div className="flex gap-3 mt-4 mb-6">
            <button
              onClick={() => load(address)}
              className="text-sm bg-kira-surface-2 border border-kira-border text-kira-text rounded px-3 py-2 hover:border-kira-accent"
            >
              Refresh DD
            </button>
            <button
              disabled
              title="Coming soon"
              className="text-sm bg-kira-surface-2 border border-kira-border text-kira-text-dim rounded px-3 py-2 cursor-not-allowed"
            >
              Add to Watchlist
            </button>
          </div>

          <div className="flex gap-1 mb-3 border-b border-kira-border">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`text-sm px-3 py-2 border-b-2 -mb-px ${
                  tab === t.id
                    ? "border-kira-accent text-kira-accent"
                    : "border-transparent text-kira-text-muted hover:text-kira-text"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "chart" && <DexToolsChart tokenAddress={address} pairAddress={card.market.pairAddress} />}
          {tab === "signals" && <SignalsChart tokenAddress={address} pairAddress={card.market.pairAddress} />}
          {tab === "transactions" && (
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
          {tab === "holders" && (
            <HoldersPanel holders={card.topHolders} top10HolderPct={card.safety.top10HolderPct} />
          )}
        </>
      )}
    </div>
  );
}
