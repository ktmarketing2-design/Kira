import { useEffect, useRef, useState } from "react";
import { createChart, ColorType, LineStyle, type IChartApi, type ISeriesApi, type Time, type IPriceLine } from "lightweight-charts";
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

type Tool = "none" | "horizontal" | "trend" | "label";

interface Drawing {
  type: "horizontal" | "trend" | "label";
  points: Array<{ time: number; price: number }>;
  text?: string;
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

export default function ChartStudio({ tokenAddress, pairAddress }: { tokenAddress: string; pairAddress: string | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const trendSeriesRef = useRef<Array<ISeriesApi<"Line">>>([]);

  const [timeframe, setTimeframe] = useState<Timeframe>("15m");
  const [tool, setTool] = useState<Tool>("none");
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [pendingTrendStart, setPendingTrendStart] = useState<{ time: number; price: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [candleCount, setCandleCount] = useState(0);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  // Chart lifecycle
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

  // Load OHLCV on timeframe/pair change
  useEffect(() => {
    if (!pairAddress || !seriesRef.current) return;
    fetchOhlcv(pairAddress, timeframe).then((candles) => {
      seriesRef.current?.setData(candles);
      setCandleCount(candles.length);
      chartRef.current?.timeScale().fitContent();
    });
  }, [pairAddress, timeframe]);

  // Load saved drawings + events once
  useEffect(() => {
    apiRequest<{ drawings: Drawing[] }>("GET", `/token/${tokenAddress}/drawings`)
      .then((res) => setDrawings(res.drawings ?? []))
      .catch(() => setDrawings([]));

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenAddress]);

  // Render drawings whenever the array changes
  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;
    for (const line of priceLinesRef.current) seriesRef.current.removePriceLine(line);
    priceLinesRef.current = [];
    for (const s of trendSeriesRef.current) chartRef.current.removeSeries(s);
    trendSeriesRef.current = [];

    for (const d of drawings) {
      if (d.type === "horizontal") {
        const line = seriesRef.current.createPriceLine({
          price: d.points[0].price,
          color: "#eab308",
          lineWidth: 1,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: "",
        });
        priceLinesRef.current.push(line);
      } else if (d.type === "label") {
        const line = seriesRef.current.createPriceLine({
          price: d.points[0].price,
          color: "#7c6fcd",
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: d.text ?? "",
        });
        priceLinesRef.current.push(line);
      } else if (d.type === "trend" && d.points.length === 2) {
        const lineSeries = chartRef.current.addLineSeries({ color: "#7c6fcd", lineWidth: 2 });
        lineSeries.setData([
          { time: d.points[0].time as Time, value: d.points[0].price },
          { time: d.points[1].time as Time, value: d.points[1].price },
        ]);
        trendSeriesRef.current.push(lineSeries);
      }
    }
  }, [drawings]);

  // Click handling for active drawing tool
  useEffect(() => {
    if (!chartRef.current || !seriesRef.current) return;
    const chart = chartRef.current;
    const series = seriesRef.current;

    const handler = (param: Parameters<Parameters<IChartApi["subscribeClick"]>[0]>[0]) => {
      if (tool === "none" || !param.time || param.point == null) return;
      const price = series.coordinateToPrice(param.point.y);
      if (price == null) return;
      const time = param.time as number;

      if (tool === "horizontal") {
        setDrawings((prev) => [...prev, { type: "horizontal", points: [{ time, price }] }]);
        setTool("none");
      } else if (tool === "label") {
        const text = window.prompt("Label text:");
        if (text) setDrawings((prev) => [...prev, { type: "label", points: [{ time, price }], text }]);
        setTool("none");
      } else if (tool === "trend") {
        if (!pendingTrendStart) {
          setPendingTrendStart({ time, price });
        } else {
          setDrawings((prev) => [...prev, { type: "trend", points: [pendingTrendStart, { time, price }] }]);
          setPendingTrendStart(null);
          setTool("none");
        }
      }
    };

    chart.subscribeClick(handler);
    return () => chart.unsubscribeClick(handler);
  }, [tool, pendingTrendStart]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await apiRequest<{ id: string }>("PUT", `/token/${tokenAddress}/drawings`, { drawings });
      setShareUrl(`${window.location.origin}/chart/${tokenAddress}/${res.id}`);
    } finally {
      setSaving(false);
    }
  }

  function handleClear() {
    setDrawings([]);
    setPendingTrendStart(null);
  }

  return (
    <div className="bg-kira-surface border border-kira-border rounded-md p-3">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex gap-1">
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
        <div className="w-px h-5 bg-kira-border mx-1" />
        <div className="flex gap-1">
          <button
            onClick={() => setTool(tool === "horizontal" ? "none" : "horizontal")}
            className={`text-xs px-2 py-1 rounded border ${tool === "horizontal" ? "border-kira-accent text-kira-accent" : "border-kira-border text-kira-text-muted"}`}
          >
            ─ Line
          </button>
          <button
            onClick={() => setTool(tool === "trend" ? "none" : "trend")}
            className={`text-xs px-2 py-1 rounded border ${tool === "trend" ? "border-kira-accent text-kira-accent" : "border-kira-border text-kira-text-muted"}`}
          >
            ↗ Trend
          </button>
          <button
            onClick={() => setTool(tool === "label" ? "none" : "label")}
            className={`text-xs px-2 py-1 rounded border ${tool === "label" ? "border-kira-accent text-kira-accent" : "border-kira-border text-kira-text-muted"}`}
          >
            ⊕ Label
          </button>
          <button onClick={handleClear} className="text-xs px-2 py-1 rounded border border-kira-border text-kira-text-muted">
            ✕ Clear
          </button>
        </div>
        <div className="w-px h-5 bg-kira-border mx-1" />
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          className="text-xs px-2 py-1 rounded border border-kira-border text-kira-text-muted disabled:opacity-50"
        >
          💾 {saving ? "Saving..." : "Save"}
        </button>
        {shareUrl && (
          <button
            onClick={() => void navigator.clipboard.writeText(shareUrl)}
            className="text-xs px-2 py-1 rounded border border-kira-border text-kira-accent"
            title={shareUrl}
          >
            📤 Copy Share Link
          </button>
        )}
      </div>

      {tool === "trend" && pendingTrendStart && (
        <p className="text-xs text-kira-text-dim mb-2">Click the second point to finish the trendline.</p>
      )}

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
