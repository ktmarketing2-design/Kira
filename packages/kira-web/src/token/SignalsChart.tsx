import { useEffect, useRef, useState } from "react";
import {
  createChart,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { apiRequest } from "../lib/api.js";

type Timeframe = "15m" | "1h" | "4h" | "1d";
const TIMEFRAMES: Timeframe[] = ["15m", "1h", "4h", "1d"];

interface RawCandle {
  timestamp: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface ChartEvent {
  id: string;
  kind: string;
  timestamp: string;
  walletCount?: number;
  totalUsd?: number | null;
}
interface KolCallEvent {
  id: string;
  sourceId: string;
  timestamp: string;
  priceAtCall: number | null;
}

const EVENT_MARKER: Record<string, { shape: "arrowUp" | "arrowDown" | "circle"; color: string }> = {
  cluster_buy: { shape: "arrowUp", color: "#22c55e" },
  cluster_sell: { shape: "arrowDown", color: "#ef4444" },
  new_token_cluster: { shape: "arrowUp", color: "#22c55e" },
  signal_filter_match: { shape: "circle", color: "#7c6fcd" },
};

/**
 * Kira Signals: candles + on-chain event markers only (cluster buys/sells, signal filter
 * matches, KOL calls). No drawing tools, no trading UI — that's the GeckoTerminal embed's job.
 * OHLCV comes from kira-api's cached /token/:address/ohlcv proxy, never GeckoTerminal directly
 * from the browser (avoids CORS and keeps GeckoTerminal's rate limit off end users).
 */
export default function SignalsChart({ tokenAddress, pairAddress }: { tokenAddress: string; pairAddress: string | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  const [timeframe, setTimeframe] = useState<Timeframe>("15m");
  const [loading, setLoading] = useState(true);
  const [candleCount, setCandleCount] = useState(0);
  const [hasEvents, setHasEvents] = useState<boolean | null>(null); // null = not checked yet

  // Chart lifecycle, created once.
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: { background: { color: "#0a0a0f" }, textColor: "#e2e8f0" },
      grid: { vertLines: { color: "#1a1a24" }, horzLines: { color: "#1a1a24" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#2a2a3a" },
      timeScale: { borderColor: "#2a2a3a", timeVisible: true, secondsVisible: false },
      width: containerRef.current.clientWidth,
      height: 500,
    });

    const series = chart.addCandlestickSeries({
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });

    const volumeSeries = chart.addHistogramSeries({
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

    chartRef.current = chart;
    seriesRef.current = series;
    volumeSeriesRef.current = volumeSeries;

    const handleResize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
    };
  }, []);

  // Load OHLCV whenever pairAddress or timeframe changes.
  useEffect(() => {
    if (!pairAddress || !seriesRef.current || !volumeSeriesRef.current) {
      setLoading(false);
      return;
    }
    setLoading(true);

    apiRequest<{ candles: RawCandle[] }>(
      "GET",
      `/token/${tokenAddress}/ohlcv?timeframe=${timeframe}&pairAddress=${encodeURIComponent(pairAddress)}`,
    )
      .then((res) => {
        const sorted = [...res.candles].sort((a, b) => a.timestamp - b.timestamp);
        seriesRef.current?.setData(
          sorted.map((c) => ({
            time: c.timestamp as UTCTimestamp,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
          })),
        );
        volumeSeriesRef.current?.setData(
          sorted.map((c) => ({
            time: c.timestamp as UTCTimestamp,
            value: c.volume,
            color: c.close >= c.open ? "#22c55e40" : "#ef444440",
          })),
        );
        setCandleCount(sorted.length);
        chartRef.current?.timeScale().fitContent();
      })
      .catch(() => setCandleCount(0))
      .finally(() => setLoading(false));
  }, [tokenAddress, pairAddress, timeframe]);

  // Load event markers once per token.
  useEffect(() => {
    apiRequest<{ alerts: ChartEvent[]; kolCalls: KolCallEvent[] }>("GET", `/token/${tokenAddress}/events`)
      .then((res) => {
        setHasEvents(res.alerts.length > 0 || res.kolCalls.length > 0);
        if (!seriesRef.current) return;
        const markers = [
          ...res.alerts.map((a) => {
            const meta = EVENT_MARKER[a.kind] ?? EVENT_MARKER.cluster_buy;
            const walletText = a.walletCount != null ? `${a.walletCount} wallets` : "";
            const usdText = a.totalUsd != null ? `$${a.totalUsd.toLocaleString("en-US")}` : "";
            return {
              time: Math.floor(new Date(a.timestamp).getTime() / 1000) as UTCTimestamp,
              position: meta.shape === "arrowDown" ? ("aboveBar" as const) : ("belowBar" as const),
              color: meta.color,
              shape: meta.shape,
              text: [walletText, usdText].filter(Boolean).join(" "),
            };
          }),
          ...res.kolCalls.map((c) => ({
            time: Math.floor(new Date(c.timestamp).getTime() / 1000) as UTCTimestamp,
            position: "aboveBar" as const,
            color: "#7c6fcd",
            shape: "circle" as const,
            text: "KOL call",
          })),
        ].sort((a, b) => (a.time as number) - (b.time as number));
        seriesRef.current.setMarkers(markers);
      })
      .catch(() => setHasEvents(false));
  }, [tokenAddress]);

  return (
    <div className="bg-kira-surface border border-kira-border rounded-md p-3">
      <div className="flex flex-wrap items-center gap-1 mb-3">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            onClick={() => setTimeframe(tf)}
            className={`text-xs px-2 py-1 rounded border ${
              timeframe === tf ? "border-kira-accent text-kira-accent" : "border-kira-border text-kira-text-muted"
            }`}
          >
            {tf}
          </button>
        ))}
      </div>

      <div className="relative">
        {!pairAddress ? (
          <div className="text-kira-text-muted text-sm py-16 text-center">
            No trading pair found for this token yet, chart unavailable.
          </div>
        ) : (
          <>
            <div ref={containerRef} style={{ height: 500 }} className={loading ? "animate-pulse" : undefined} />

            {loading && (
              <div className="absolute inset-0 flex items-center justify-center bg-kira-bg/60">
                <div className="text-kira-text-dim text-sm animate-pulse">Loading chart...</div>
              </div>
            )}

            {!loading && hasEvents === false && (
              <div className="absolute inset-0 flex items-center justify-center bg-kira-bg/70 pointer-events-none">
                <p className="text-kira-text-muted text-sm text-center max-w-xs leading-relaxed px-4">
                  No Kira signals yet for this token.
                  <br />
                  Signals appear when your tracked wallets buy,
                  <br />
                  your KOL channels call it, or a Signal Filter fires.
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {pairAddress && !loading && candleCount === 0 && (
        <p className="text-xs text-kira-text-dim mt-2">No candle data returned for this timeframe yet.</p>
      )}
    </div>
  );
}
