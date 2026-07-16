import { useEffect, useRef, useState } from "react";
import { createChart, ColorType, type IChartApi, type ISeriesApi, type Time } from "lightweight-charts";
import { apiRequest } from "../lib/api.js";

type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
const TIMEFRAME_PARAMS: Record<Timeframe, { unit: "minute" | "hour" | "day"; aggregate: number }> = {
  "1m": { unit: "minute", aggregate: 1 },
  "5m": { unit: "minute", aggregate: 5 },
  "15m": { unit: "minute", aggregate: 15 },
  "1h": { unit: "hour", aggregate: 1 },
  "4h": { unit: "hour", aggregate: 4 },
  "1d": { unit: "day", aggregate: 1 },
};

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

const EVENT_MARKER: Record<string, { shape: "arrowUp" | "arrowDown" | "circle"; color: string; text: string }> = {
  cluster_buy: { shape: "arrowUp", color: "#22c55e", text: "Cluster buy" },
  cluster_sell: { shape: "arrowDown", color: "#ef4444", text: "Cluster sell" },
  new_token_cluster: { shape: "arrowUp", color: "#22c55e", text: "New token cluster" },
  signal_filter_match: { shape: "circle", color: "#7c6fcd", text: "Signal filter match" },
};

async function fetchOhlcv(poolAddress: string, timeframe: Timeframe): Promise<Array<{ time: Time; open: number; high: number; low: number; close: number }>> {
  const { unit, aggregate } = TIMEFRAME_PARAMS[timeframe];
  const res = await fetch(
    `https://api.geckoterminal.com/api/v2/networks/solana/pools/${poolAddress}/ohlcv/${unit}?aggregate=${aggregate}&limit=300`,
  );
  if (!res.ok) return [];
  const json = await res.json();
  const list: number[][] = json?.data?.attributes?.ohlcv_list ?? [];
  return list
    .map(([ts, o, h, l, c]) => ({ time: ts as Time, open: o, high: h, low: l, close: c }))
    .sort((a, b) => (a.time as number) - (b.time as number));
}

/**
 * Kira's own lightweight chart, scoped down to exactly one job: plot on-chain event markers
 * (cluster buys/sells, signal filter matches, KOL calls) over candles. No drawing tools, no
 * volume bars, no save/share — DEXTools (the primary Chart tab) already covers all of that with
 * a full professional toolset. This tab exists only for Kira's unique on-chain signal layer.
 */
export default function SignalsChart({ tokenAddress, pairAddress }: { tokenAddress: string; pairAddress: string | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  const [timeframe, setTimeframe] = useState<Timeframe>("15m");
  const [candleCount, setCandleCount] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: "#111118" }, textColor: "#94a3b8" },
      grid: { vertLines: { color: "#2a2a3a" }, horzLines: { color: "#2a2a3a" } },
      width: containerRef.current.clientWidth,
      height: 420,
      timeScale: { timeVisible: true },
    });
    const series = chart.addCandlestickSeries({
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const handleResize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
    };
  }, []);

  useEffect(() => {
    if (!pairAddress || !seriesRef.current) return;
    fetchOhlcv(pairAddress, timeframe).then((candles) => {
      seriesRef.current?.setData(candles);
      setCandleCount(candles.length);
      chartRef.current?.timeScale().fitContent();
    });
  }, [pairAddress, timeframe]);

  useEffect(() => {
    apiRequest<{ alerts: ChartEvent[]; kolCalls: KolCallEvent[] }>("GET", `/token/${tokenAddress}/events`)
      .then((res) => {
        if (!seriesRef.current) return;
        const markers = [
          ...res.alerts.map((a) => {
            const meta = EVENT_MARKER[a.kind] ?? EVENT_MARKER.cluster_buy;
            return {
              time: Math.floor(new Date(a.timestamp).getTime() / 1000) as Time,
              position: meta.shape === "arrowDown" ? ("aboveBar" as const) : ("belowBar" as const),
              color: meta.color,
              shape: meta.shape,
              text: meta.text,
            };
          }),
          ...res.kolCalls.map((c) => ({
            time: Math.floor(new Date(c.timestamp).getTime() / 1000) as Time,
            position: "belowBar" as const,
            color: "#a78bfa",
            shape: "circle" as const,
            text: "KOL call",
          })),
        ].sort((a, b) => (a.time as number) - (b.time as number));
        seriesRef.current.setMarkers(markers);
      })
      .catch(() => {});
  }, [tokenAddress]);

  return (
    <div className="bg-kira-surface border border-kira-border rounded-md p-3">
      <div className="flex flex-wrap items-center gap-1 mb-3">
        {(Object.keys(TIMEFRAME_PARAMS) as Timeframe[]).map((tf) => (
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

      {!pairAddress ? (
        <div className="text-kira-text-muted text-sm py-16 text-center">
          No trading pair found for this token yet, chart unavailable.
        </div>
      ) : (
        <div ref={containerRef} />
      )}
      {pairAddress && candleCount === 0 && (
        <p className="text-xs text-kira-text-dim mt-2">No candle data returned for this timeframe yet.</p>
      )}
    </div>
  );
}
