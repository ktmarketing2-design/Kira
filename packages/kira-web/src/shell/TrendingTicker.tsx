import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../lib/api.js";

const REFRESH_INTERVAL_MS = 60_000;

interface TrendingToken {
  address: string;
  symbol: string | null;
  priceUsd: number | null;
  priceChange5mPct: number | null;
}

export default function TrendingTicker() {
  const navigate = useNavigate();
  const [tokens, setTokens] = useState<TrendingToken[]>([]);

  useEffect(() => {
    function load() {
      apiRequest<{ tokens: TrendingToken[] }>("GET", "/trending/ticker")
        .then((res) => setTokens(res.tokens))
        .catch(() => {});
    }
    load();
    const interval = setInterval(load, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  if (tokens.length === 0) return null;

  // Rendered twice back to back so the -50% translateX loop point lines up seamlessly (see the
  // .kira-ticker-track keyframes in index.css) instead of jumping/blanking at the wrap.
  const items = [...tokens, ...tokens];

  return (
    <div className="h-9 border-b border-kira-border bg-kira-surface overflow-hidden whitespace-nowrap">
      <div className="kira-ticker-track inline-flex items-center h-9">
        {items.map((t, i) => (
          <button
            key={`${t.address}-${i}`}
            onClick={() => navigate(`/token/${t.address}`)}
            className="inline-flex items-center gap-1.5 px-4 font-data text-[13px] shrink-0 hover:opacity-80"
          >
            <span className="text-kira-text">${t.symbol ?? "?"}</span>
            {t.priceChange5mPct != null && (
              <span className={t.priceChange5mPct >= 0 ? "text-kira-green" : "text-kira-red"}>
                {t.priceChange5mPct >= 0 ? "+" : ""}
                {t.priceChange5mPct.toFixed(1)}%
              </span>
            )}
            <span className="text-kira-text-dim">•</span>
          </button>
        ))}
      </div>
    </div>
  );
}
