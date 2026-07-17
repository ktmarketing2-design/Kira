import { useEffect, useState, type MouseEvent } from "react";
import { apiRequest, ApiError } from "../lib/api.js";

interface Props {
  tokenAddress: string;
  tokenSymbol?: string | null;
  tokenName?: string | null;
  variant?: "link" | "button";
}

/** Add/remove a token from the user's watchlist. Checks membership on mount via GET
 * /watchlist/:tokenAddress and toggles with POST/DELETE. Used on the dashboard alert cards, the
 * token page sidebar, and the discover page rows -- one component so the three surfaces can't
 * drift out of sync on how "in watchlist" is displayed. */
export default function WatchlistButton({ tokenAddress, tokenSymbol, tokenName, variant = "link" }: Props) {
  const [inWatchlist, setInWatchlist] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiRequest<{ inWatchlist: boolean }>("GET", `/watchlist/${tokenAddress}`)
      .then((res) => {
        if (!cancelled) setInWatchlist(res.inWatchlist);
      })
      .catch(() => {
        if (!cancelled) setInWatchlist(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tokenAddress]);

  async function toggle(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy || inWatchlist == null) return;
    setBusy(true);
    try {
      if (inWatchlist) {
        await apiRequest("DELETE", `/watchlist/${tokenAddress}`);
        setInWatchlist(false);
      } else {
        await apiRequest("POST", "/watchlist", {
          tokenAddress,
          tokenSymbol: tokenSymbol ?? undefined,
          tokenName: tokenName ?? undefined,
        });
        setInWatchlist(true);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        window.alert("Watchlist limit reached for your tier. Upgrade to add more tokens.");
      }
    } finally {
      setBusy(false);
    }
  }

  const label = inWatchlist ? "★ Watchlisted" : "Add to Watchlist";

  if (variant === "button") {
    return (
      <button
        onClick={toggle}
        disabled={busy || inWatchlist == null}
        className={`text-sm rounded px-3 py-2 border disabled:opacity-50 ${
          inWatchlist
            ? "border-kira-accent text-kira-accent bg-kira-accent/10"
            : "border-kira-border text-kira-text-muted hover:border-kira-accent hover:text-kira-text"
        }`}
      >
        {label}
      </button>
    );
  }

  return (
    <button
      onClick={toggle}
      disabled={busy || inWatchlist == null}
      className={`text-xs hover:underline disabled:opacity-50 ${
        inWatchlist ? "text-kira-accent" : "text-kira-text-dim"
      }`}
    >
      {label}
    </button>
  );
}
