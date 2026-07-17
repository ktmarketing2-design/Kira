import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../lib/api.js";
import type { DdCard } from "../lib/types.js";

interface WatchlistToken {
  id: string;
  tokenAddress: string;
  tokenSymbol: string | null;
  tokenName: string | null;
  addedAt: string;
  notes: string | null;
}

function fmtUsd(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(v < 1 ? 6 : 2)}`;
}

/** One row's cached-DD lookup, isolated per row so a slow/missing cache entry for one token
 * doesn't block the rest of the table from rendering. */
function useCachedCard(tokenAddress: string): DdCard | null {
  const [card, setCard] = useState<DdCard | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiRequest<{ card: DdCard | null }>("GET", `/token/${tokenAddress}/dd-cached`)
      .then((res) => {
        if (!cancelled) setCard(res.card);
      })
      .catch(() => {
        if (!cancelled) setCard(null);
      });
    return () => {
      cancelled = true;
    };
  }, [tokenAddress]);
  return card;
}

function WatchlistRow({ token, onRemove }: { token: WatchlistToken; onRemove: (address: string) => void }) {
  const navigate = useNavigate();
  const card = useCachedCard(token.tokenAddress);

  return (
    <tr
      className="border-b border-kira-border last:border-0 cursor-pointer hover:bg-kira-surface-2/50"
      onClick={() => navigate(`/token/${token.tokenAddress}`)}
    >
      <td className="px-4 py-3 text-kira-text">${token.tokenSymbol ?? card?.symbol ?? "?"}</td>
      <td className="px-4 py-3 text-kira-text-muted">{token.tokenName ?? card?.name ?? "—"}</td>
      <td className="px-4 py-3 text-kira-text-dim text-xs">{new Date(token.addedAt).toLocaleDateString()}</td>
      <td className="px-4 py-3 font-data text-xs text-kira-text-muted">{fmtUsd(card?.market.priceUsd)}</td>
      <td className="px-4 py-3 font-data text-xs text-kira-text-dim">—</td>
      <td className="px-4 py-3 font-data text-xs text-kira-text-muted">{card?.safety.rugScore ?? "—"}</td>
      <td className="px-4 py-3 font-data text-xs text-kira-text-muted">{card?.volume?.score ?? "—"}</td>
      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 text-xs">
          <button
            onClick={() => navigate(`/token/${token.tokenAddress}`)}
            className="text-kira-accent hover:underline"
          >
            DD
          </button>
          <button onClick={() => onRemove(token.tokenAddress)} className="text-kira-red hover:underline">
            Remove
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function WatchlistPage() {
  const [tokens, setTokens] = useState<WatchlistToken[]>([]);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    apiRequest<{ tokens: WatchlistToken[] }>("GET", "/watchlist")
      .then((res) => setTokens(res.tokens))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleRemove(address: string) {
    await apiRequest("DELETE", `/watchlist/${address}`);
    setTokens((prev) => prev.filter((t) => t.tokenAddress !== address));
  }

  return (
    <div>
      <h1 className="font-display text-lg text-kira-text mb-4">Watchlist</h1>

      {loading ? (
        <div className="text-kira-text-muted text-sm">Loading...</div>
      ) : tokens.length === 0 ? (
        <div className="bg-kira-surface border border-kira-border rounded-md p-8 text-center">
          <p className="text-kira-text text-sm">No tokens saved yet.</p>
          <p className="text-kira-text-muted text-xs mt-1">Add tokens from the Discover page or any DD card.</p>
        </div>
      ) : (
        <div className="bg-kira-surface border border-kira-border rounded-md overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-kira-text-muted border-b border-kira-border">
                <th className="px-4 py-3 font-normal">Symbol</th>
                <th className="px-4 py-3 font-normal">Name</th>
                <th className="px-4 py-3 font-normal">Added</th>
                <th className="px-4 py-3 font-normal">Price</th>
                <th className="px-4 py-3 font-normal">24h</th>
                <th className="px-4 py-3 font-normal">Rug Score</th>
                <th className="px-4 py-3 font-normal">Volume Score</th>
                <th className="px-4 py-3 font-normal"></th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <WatchlistRow key={t.id} token={t} onRemove={handleRemove} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
