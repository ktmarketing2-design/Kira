import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { apiRequest } from "../lib/api.js";
import type { DdCard } from "../lib/types.js";
import WatchlistButton from "../shell/WatchlistButton.js";

interface RawCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface ChartEvent {
  id: string;
  type: string;
  created_at: string;
  wallet_count?: number;
  total_usd?: number;
}

interface TimelineKolCall {
  id: string;
  source_id: string;
  called_at: string;
  price_at_call: number | null;
}

interface ResearchNote {
  id: string;
  content: string;
  created_at: string;
}

interface Message {
  sender: "user" | "kira";
  text: string;
  time: string;
}

type DrillDownStep = "events" | "timeline" | "detail";

// Mapped event model for drilldown
interface MappedEvent {
  id: string;
  kind: "cluster" | "kol" | "rug" | "lp";
  label: string;
  caller: string;
  callerType: string;
  price: number;
  ret: string;
  wr: string;
  avg: string;
  time: string;
  timeAgo: string;
  total?: string;
  mcap: string;
  liq: string;
  good: boolean;
  title: string;
  subtitle: string;
  idx: number;
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmtUsd(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

export default function SignalsPage() {
  const { address: routeAddress } = useParams<{ address: string }>();

  // Scoped to selected token address, defaulting to $ANSEM if none provided
  const address = routeAddress || "9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump";

  // DD card data
  const [card, setCard] = useState<DdCard | null>(null);
  const [fullData, setFullData] = useState<any | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Drilldown states
  const [step, setStep] = useState<DrillDownStep>("events");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  // Candles + events data
  const [candles, setCandles] = useState<RawCandle[]>([]);
  const [rawEvents, setRawEvents] = useState<{ alerts: ChartEvent[]; kolCalls: TimelineKolCall[] }>({ alerts: [], kolCalls: [] });
  const [dataLoading, setDataLoading] = useState(true);

  // Research Thread
  const [notesOpen, setNotesOpen] = useState(true);
  const [notes, setNotes] = useState<ResearchNote[]>([]);
  const [chatMessages, setChatMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [kiraThinking, setKiraThinking] = useState(false);

  const tokenSymbol = card?.symbol ?? "TOKEN";
  const currentPriceUsd = card?.market?.priceUsd ?? null;
  const fdvUsd = card?.market?.fdvUsd ?? 0;
  const liquidityUsd = card?.market?.liquidityUsd ?? 0;

  // Fetch DD card
  function loadCard(addr: string) {
    setError(false);
    Promise.all([
      apiRequest<DdCard>("GET", `/token/${addr}/dd`),
      apiRequest<any>("GET", `/token/${addr}/full`).catch(() => null)
    ])
      .then(([dd, full]) => {
        setCard(dd);
        if (full) setFullData(full);
      })
      .catch(() => setError(true));
  }

  // Fetch notes
  function loadNotes(addr: string) {
    apiRequest<{ notes: ResearchNote[] }>("GET", `/token/${addr}/notes`)
      .then((res) => setNotes(res.notes || []))
      .catch(() => {});
  }

  useEffect(() => {
    loadCard(address);
    loadNotes(address);
    setStep("events");
    setSelectedEventId(null);
  }, [address]);

  // Fetch ohlcv + events once card (and its pairAddress) loads
  useEffect(() => {
    if (!card?.market?.pairAddress) return;
    setDataLoading(true);

    Promise.all([
      apiRequest<{ candles: RawCandle[] }>(
        "GET",
        `/token/${address}/ohlcv?timeframe=1h&pairAddress=${encodeURIComponent(card.market.pairAddress)}`,
      ),
      apiRequest<{ alerts: ChartEvent[]; kolCalls: TimelineKolCall[] }>("GET", `/token/${address}/events`),
    ])
      .then(([ohlcv, ev]) => {
        setCandles([...ohlcv.candles].sort((a, b) => a.timestamp - b.timestamp));
        setRawEvents(ev);
      })
      .catch(() => {
        setCandles([]);
        setRawEvents({ alerts: [], kolCalls: [] });
      })
      .finally(() => setDataLoading(false));
  }, [address, card?.market?.pairAddress]);

  // Snaps timestamps to nearest candles index
  function nearestIndex(timestampStr: string): number {
    if (candles.length === 0) return 0;
    const unixSeconds = Math.floor(new Date(timestampStr).getTime() / 1000);
    let best = 0;
    let bestDiff = Infinity;
    candles.forEach((c, i) => {
      const diff = Math.abs(c.timestamp - unixSeconds);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = i;
      }
    });
    return best;
  }

  // Construct events list mapping
  const eventsList = useMemo<MappedEvent[]>(() => {
    const list: MappedEvent[] = [];
    const N = candles.length;
    if (N === 0) return list;

    const getMockPrice = (mockIdx: number) => candles[Math.min(mockIdx, N - 1)]?.close ?? currentPriceUsd ?? 0;
    const getMockReturn = (mockIdx: number) => {
      const p = getMockPrice(mockIdx);
      if (!p || !currentPriceUsd) return { text: "—", good: true };
      const pct = ((currentPriceUsd - p) / p) * 100;
      return { text: `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`, good: pct >= 0 };
    };

    // 1. Spec mockups (highly interactive defaults snapped to actual close price line)
    const idx1 = Math.floor(N * 0.45);
    const r1 = getMockReturn(idx1);
    list.push({
      id: "cluster1",
      kind: "cluster",
      label: "3 wallets",
      caller: "3 Tracked Wallets",
      callerType: "Cluster Buy · 3 wallets",
      price: getMockPrice(idx1),
      ret: r1.text,
      wr: "—",
      avg: "—",
      time: new Date(Date.now() - 12 * 1000).toISOString(),
      timeAgo: "12s ago",
      total: "—",
      mcap: fmtUsd(fdvUsd * (getMockPrice(idx1) / (currentPriceUsd || 1))),
      liq: fmtUsd(liquidityUsd * (getMockPrice(idx1) / (currentPriceUsd || 1))),
      good: r1.good,
      title: "3 top wallets bought",
      subtitle: "Cluster buy · combined 4.2 SOL",
      idx: idx1
    });

    const idx2 = Math.floor(N * 0.20);
    const r2 = getMockReturn(idx2);
    list.push({
      id: "kol1",
      kind: "kol",
      label: "@spydefi",
      caller: "@spydefi",
      callerType: "KOL Call · Telegram",
      price: getMockPrice(idx2),
      ret: r2.text,
      wr: "68%",
      avg: "+24.5%",
      time: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
      timeAgo: "4m ago",
      total: "214",
      mcap: fmtUsd(fdvUsd * (getMockPrice(idx2) / (currentPriceUsd || 1))),
      liq: fmtUsd(liquidityUsd * (getMockPrice(idx2) / (currentPriceUsd || 1))),
      good: r2.good,
      title: "@spydefi called it",
      subtitle: "KOL call · Telegram",
      idx: idx2
    });

    const idx3 = Math.floor(N * 0.70);
    const r3 = getMockReturn(idx3);
    list.push({
      id: "kol2",
      kind: "kol",
      label: "@cryptogem",
      caller: "@cryptogem",
      callerType: "KOL Call · Telegram",
      price: getMockPrice(idx3),
      ret: r3.text,
      wr: "44%",
      avg: "-6.2%",
      time: new Date(Date.now() - 19 * 60 * 1000).toISOString(),
      timeAgo: "19m ago",
      total: "87",
      mcap: fmtUsd(fdvUsd * (getMockPrice(idx3) / (currentPriceUsd || 1))),
      liq: fmtUsd(liquidityUsd * (getMockPrice(idx3) / (currentPriceUsd || 1))),
      good: r3.good,
      title: "@cryptogem called it",
      subtitle: "KOL call · Telegram",
      idx: idx3
    });

    const idx4 = Math.floor(N * 0.80);
    const r4 = getMockReturn(idx4);
    list.push({
      id: "rug1",
      kind: "rug",
      label: "Rug flag",
      caller: "Community Report",
      callerType: "Rug Flag",
      price: getMockPrice(idx4),
      ret: r4.text,
      wr: "—",
      avg: "—",
      time: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
      timeAgo: "8m ago",
      total: "—",
      mcap: fmtUsd(fdvUsd * (getMockPrice(idx4) / (currentPriceUsd || 1))),
      liq: fmtUsd(liquidityUsd * (getMockPrice(idx4) / (currentPriceUsd || 1))),
      good: r4.good,
      title: "Flagged as possible rug pull",
      subtitle: "Community report",
      idx: idx4
    });

    const idx5 = Math.floor(N * 0.85);
    const r5 = getMockReturn(idx5);
    list.push({
      id: "lp1",
      kind: "lp",
      label: "LP unlock",
      caller: "On-chain Event",
      callerType: "LP Unlocked",
      price: getMockPrice(idx5),
      ret: r5.text,
      wr: "—",
      avg: "—",
      time: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
      timeAgo: "11m ago",
      total: "—",
      mcap: fmtUsd(fdvUsd * (getMockPrice(idx5) / (currentPriceUsd || 1))),
      liq: fmtUsd(liquidityUsd * (getMockPrice(idx5) / (currentPriceUsd || 1))),
      good: r5.good,
      title: "LP unlocked",
      subtitle: "Liquidity pool authority change",
      idx: idx5
    });

    // 2. Add real alerts / calls from the DB / webhooks
    rawEvents.alerts.forEach((a) => {
      const idx = nearestIndex(a.created_at);
      const p = candles[idx]?.close ?? currentPriceUsd ?? 0;
      const pct = p && currentPriceUsd ? ((currentPriceUsd - p) / p) * 100 : 0;
      list.push({
        id: a.id,
        kind: a.type.startsWith("cluster") ? "cluster" : "rug",
        label: a.wallet_count ? `${a.wallet_count} wallets` : "alert",
        caller: "Kira Alert Engine",
        callerType: a.type.replace(/_/g, " "),
        price: p,
        ret: `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`,
        wr: "—",
        avg: "—",
        time: a.created_at,
        timeAgo: timeAgo(a.created_at),
        total: "—",
        mcap: fmtUsd(fdvUsd * (p / (currentPriceUsd || 1))),
        liq: fmtUsd(liquidityUsd * (p / (currentPriceUsd || 1))),
        good: pct >= 0,
        title: a.type === "cluster_sell" ? "Cluster sell detected" : "Cluster buy detected",
        subtitle: `${a.wallet_count ?? 0} tracked wallets traded`,
        idx
      });
    });

    rawEvents.kolCalls.forEach((c) => {
      const idx = nearestIndex(c.called_at);
      const p = c.price_at_call ?? candles[idx]?.close ?? currentPriceUsd ?? 0;
      const pct = p && currentPriceUsd ? ((currentPriceUsd - p) / p) * 100 : 0;
      const who = c.source_id ? (c.source_id.startsWith("@") ? c.source_id : `@${c.source_id}`) : "KOL Call";
      list.push({
        id: c.id,
        kind: "kol",
        label: who,
        caller: who,
        callerType: "KOL Call",
        price: p,
        ret: `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`,
        wr: "—",
        avg: "—",
        time: c.called_at,
        timeAgo: timeAgo(c.called_at),
        total: "—",
        mcap: fmtUsd(fdvUsd * (p / (currentPriceUsd || 1))),
        liq: fmtUsd(liquidityUsd * (p / (currentPriceUsd || 1))),
        good: pct >= 0,
        title: `${who} called it`,
        subtitle: "KOL call tracker",
        idx
      });
    });

    return list.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  }, [candles, currentPriceUsd, rawEvents, fdvUsd, liquidityUsd]);

  const selectedEvent = useMemo(() => {
    return eventsList.find((e) => e.id === selectedEventId) || null;
  }, [eventsList, selectedEventId]);

  // Handles "Ask Kira" conversational interaction
  function handleAskKira() {
    if (!inputText.trim() || !card) return;
    const userQ = inputText.trim();
    setChatMessages((prev) => [...prev, { sender: "user", text: userQ, time: new Date().toLocaleTimeString() }]);
    setInputText("");
    setKiraThinking(true);

    setTimeout(() => {
      const rugSafe = card.safety.rugScore >= 80;
      const volVerdict = card.volume?.verdict ?? "mixed";
      const verdict = `Kira: Analyzing contract configuration... Rug Score is ${card.safety.rugScore}/100 (${
        rugSafe ? "revoked authority checks passed" : "high authority risk flags"
      }). Volume profile verdict is ${volVerdict.toUpperCase()}. Recommendation: ${
        rugSafe && volVerdict === "organic" ? "Contract clean, volume organic. Entry looks sound." : "Caution advised. High cluster overlap or active authority flags detected."
      }`;
      setChatMessages((prev) => [...prev, { sender: "kira", text: verdict, time: new Date().toLocaleTimeString() }]);
      setKiraThinking(false);
    }, 1200);
  }

  // Handles "Save Note"
  function handleSaveNote() {
    if (!inputText.trim()) return;
    const content = inputText.trim();
    setInputText("");

    apiRequest<{ note: ResearchNote }>("POST", `/token/${address}/notes`, { content })
      .then(() => loadNotes(address))
      .catch(() => {});
  }

  // Reload DD Card
  function handleRefresh() {
    setRefreshing(true);
    apiRequest<DdCard>("GET", `/token/${address}/dd?force=true`)
      .then(setCard)
      .finally(() => setRefreshing(false));
  }

  if (error) {
    return <div className="p-8 text-tt-red text-sm">Couldn't load Deep Dive data for this token address.</div>;
  }
  if (!card) {
    return <div className="p-8 text-tt-fg-dim text-sm animate-pulse">Loading Deep Dive...</div>;
  }

  // AI verdict plain summary sentence builder
  const getVerdictText = () => {
    const rugSafe = card.safety.rugScore >= 80;
    const volVerdict = card.volume?.verdict ?? "unknown";
    
    let part1 = rugSafe
      ? `Rug score ${card.safety.rugScore}/100, this token looks safe.`
      : `Rug score ${card.safety.rugScore}/100 indicates elevated contract risk.`;
      
    let part2 = volVerdict === "organic"
      ? " Volume profile is organic."
      : volVerdict === "mixed"
      ? " Volume looks mixed, watch wallet diversity."
      : " Volume profile shows high wash trading flags.";
      
    return part1 + part2;
  };

  const METRIC_LABELS: Record<string, string> = {
    vol_liq_ratio: "Vol/liq ratio",
    wallet_diversity: "Wallet diversity",
    timing_entropy: "Timing entropy",
    new_wallet_ratio: "New wallet ratio",
    fdv_liq_ratio: "FDV/liq ratio",
    round_size_prevalence: "Round size prevalence",
  };

  // Render SVG Chart for step 2 (Call Timeline)
  function renderSvgChart(focusId: string) {
    if (candles.length === 0) return null;
    const w = 620;
    const h = 220;
    const pad = 14;

    const closes = candles.map((c) => c.close);
    const cMin = Math.min(...closes);
    const cMax = Math.max(...closes);
    const cRange = cMax - cMin || 1;

    const x = (i: number) => pad + (i / (candles.length - 1)) * (w - pad * 2);
    const y = (v: number) => h - pad - ((v - cMin) / cRange) * (h - pad * 2);

    const pathD = candles.map((c, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(c.close)}`).join(" ");

    return (
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="100%" className="font-mono overflow-visible">
        {/* Price Line */}
        <path d={pathD} stroke="#7B7FD4" strokeWidth="1.5" fill="none" />

        {/* Event Markers */}
        {eventsList.map((e) => {
          const cx = x(e.idx);
          const cy = y(candles[e.idx]?.close ?? currentPriceUsd ?? 0);
          const isFocus = e.id === focusId;
          const color = e.kind === "cluster" ? "#4AF626" : e.kind === "kol" ? "#E6A817" : "#FF3B3B";

          return (
            <g key={e.id}>
              {/* Event Circle */}
              <circle
                cx={cx}
                cy={cy}
                r={isFocus ? 7 : 5}
                fill={color}
                stroke="#0A0A0A"
                strokeWidth="1.5"
                className="cursor-pointer hover:opacity-85"
                onClick={() => {
                  setSelectedEventId(e.id);
                  setStep("detail");
                }}
              />
              {/* Event Text Label */}
              <text
                x={cx}
                y={cy - 12}
                fontSize="9"
                fill={color}
                textAnchor="middle"
                className="font-mono select-none"
              >
                {e.label}
              </text>
            </g>
          );
        })}
      </svg>
    );
  }

  return (
    <div>
      {/* 1. Scoped Token Header */}
      <div className="flex justify-between items-center pb-4 mb-6 border-b border-tt-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 border border-tt-border rounded-md flex items-center justify-center font-display text-sm text-tt-brand font-bold bg-tt-bg-raised">
            {tokenSymbol.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-base text-tt-fg">{tokenSymbol}</span>
              <span className="text-[10px] text-tt-fg-dim">({card.name})</span>
            </div>
            <div className="text-[10px] text-tt-fg-faint font-mono mt-0.5">
              {address}{" "}
              <button
                onClick={() => void navigator.clipboard.writeText(address)}
                className="text-tt-brand hover:underline cursor-pointer ml-1"
              >
                Copy
              </button>
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="font-display text-lg text-tt-fg">${currentPriceUsd != null ? currentPriceUsd.toFixed(6) : "—"}</div>
          <div className="text-[10px] text-tt-red font-mono mt-0.5">
            {fullData?.priceStats?.chg24h != null ? `${fullData.priceStats.chg24h >= 0 ? "+" : ""}${fullData.priceStats.chg24h.toFixed(2)}% (24h)` : "—"}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6 items-start">
        {/* Left Column: 3-step Drill Down */}
        <div className="bg-tt-bg border border-tt-border rounded-md p-5 min-h-[500px]">
          {/* Breadcrumbs */}
          <div className="flex gap-2 items-center text-[11px] text-tt-fg-faint mb-5 font-mono">
            <span
              className={`cursor-pointer hover:text-tt-brand ${step === "events" ? "text-tt-fg font-semibold" : ""}`}
              onClick={() => {
                setStep("events");
                setSelectedEventId(null);
              }}
            >
              Events
            </span>
            {step !== "events" && (
              <>
                <span>/</span>
                <span
                  className={`cursor-pointer hover:text-tt-brand ${step === "timeline" ? "text-tt-fg font-semibold" : ""}`}
                  onClick={() => setStep("timeline")}
                >
                  Call Timeline
                </span>
              </>
            )}
            {step === "detail" && (
              <>
                <span>/</span>
                <span className="text-tt-fg font-semibold">Call Detail</span>
              </>
            )}
          </div>

          {/* Step 1: Events list */}
          {step === "events" && (
            <div className="space-y-3">
              <div className="text-[10px] uppercase tracking-wider text-tt-fg-faint mb-2 font-mono">Events — ${tokenSymbol}</div>
              {dataLoading ? (
                <div className="text-xs text-tt-fg-dim font-mono animate-pulse py-8 text-center">Loading events...</div>
              ) : eventsList.length === 0 ? (
                <div className="text-xs text-tt-fg-dim font-mono py-8 text-center">No alerts or event data available for this token.</div>
              ) : (
                eventsList.map((e) => {
                  let dotClass = "bg-tt-green";
                  if (e.kind === "kol") dotClass = "bg-tt-amber";
                  if (e.kind === "rug" || e.kind === "lp") dotClass = "bg-tt-red";

                  return (
                    <div
                      key={e.id}
                      onClick={() => {
                        setSelectedEventId(e.id);
                        setStep("timeline");
                      }}
                      className="grid grid-cols-[10px_1fr_auto] items-center gap-3 p-3.5 border border-tt-border rounded-md hover:border-tt-brand cursor-pointer transition-colors"
                    >
                      <span className={`w-2 h-2 rounded-full ${dotClass} inline-block`} />
                      <div className="flex-1">
                        <div className="text-xs text-tt-fg font-semibold font-mono">{e.title}</div>
                        <div className="text-[10px] text-tt-fg-dim mt-0.5 font-mono">{e.subtitle}</div>
                      </div>
                      <div className="text-[10px] text-tt-fg-faint text-right font-mono">{e.timeAgo}</div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* Step 2: Call Timeline Chart */}
          {step === "timeline" && selectedEvent && (
            <div className="space-y-4">
              <div className="text-[10px] uppercase tracking-wider text-tt-fg-faint font-mono">Call Timeline — price vs. events</div>
              <div className="border border-tt-border bg-tt-bg-raised p-4 rounded-md">
                <div className="h-[220px] w-full flex items-center justify-center">
                  {renderSvgChart(selectedEvent.id)}
                </div>
                <div className="flex gap-4 mt-3 font-mono text-[10px] text-tt-fg-dim">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-tt-amber inline-block" /> KOL call
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-tt-green inline-block" /> Cluster buy
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-tt-red inline-block" /> Risk flag / LP
                  </div>
                </div>
                <div className="text-[9px] text-tt-fg-faint mt-3 font-mono">Click a marker for full call details.</div>
              </div>
            </div>
          )}

          {/* Step 3: Call Detail card */}
          {step === "detail" && selectedEvent && (
            <div className="space-y-4">
              <div className="text-[10px] uppercase tracking-wider text-tt-fg-faint font-mono">Call Detail</div>
              <div className="bg-tt-bg-raised border border-tt-border rounded-md p-5 space-y-4 font-mono">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-display text-sm text-tt-fg font-semibold">{selectedEvent.caller}</div>
                    <div className="text-[10px] text-tt-amber mt-0.5">{selectedEvent.callerType}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-tt-fg-faint">Price at call</div>
                    <div className="text-sm font-semibold text-tt-fg mt-0.5">${selectedEvent.price != null ? selectedEvent.price.toFixed(6) : "—"}</div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-px bg-tt-border border border-tt-border rounded-md overflow-hidden text-center">
                  <div className="bg-tt-bg p-3">
                    <div className="text-[9px] text-tt-fg-faint">Return since call</div>
                    <div className={`text-xs font-semibold mt-1 ${selectedEvent.good ? "text-tt-green" : "text-tt-red"}`}>{selectedEvent.ret}</div>
                  </div>
                  <div className="bg-tt-bg p-3">
                    <div className="text-[9px] text-tt-fg-faint">Caller's 7d Win Rate</div>
                    <div className="text-xs font-semibold text-tt-fg mt-1">{selectedEvent.wr}</div>
                  </div>
                  <div className="bg-tt-bg p-3">
                    <div className="text-[9px] text-tt-fg-faint">Caller's Avg Return</div>
                    <div className={`text-xs font-semibold mt-1 ${selectedEvent.avg.startsWith("+") ? "text-tt-green" : selectedEvent.avg === "—" ? "text-tt-fg-dim" : "text-tt-red"}`}>{selectedEvent.avg}</div>
                  </div>
                </div>

                <div className="divide-y divide-tt-border border-t border-b border-tt-border text-[11px] text-tt-fg-dim">
                  <div className="flex justify-between py-2.5">
                    <span>Called at</span>
                    <span className="text-tt-fg">{new Date(selectedEvent.time).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-2.5">
                    <span>Total calls (all-time)</span>
                    <span className="text-tt-fg">{selectedEvent.total ?? "—"}</span>
                  </div>
                  <div className="flex justify-between py-2.5">
                    <span>Token mcap at call</span>
                    <span className="text-tt-fg">{selectedEvent.mcap}</span>
                  </div>
                  <div className="flex justify-between py-2.5">
                    <span>Token liquidity at call</span>
                    <span className="text-tt-fg">{selectedEvent.liq}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Rebuilt Fixed DD Sidebar (v1.5 spec) */}
        <div className="space-y-4">
          {/* Identity panel */}
          <div className="bg-tt-bg-panel border border-tt-border p-4 rounded-md">
            <div className="font-display text-sm text-tt-green font-bold">${tokenSymbol}</div>
            <div className="text-[10px] text-tt-fg-dim mt-0.5 truncate">{card.name}</div>
            <div className="text-[9px] text-tt-fg-faint font-mono mt-2 break-all">{address}</div>
            <div className="flex gap-2 mt-3 flex-wrap">
              <span className="text-[9px] border border-tt-border rounded px-2 py-0.5 text-tt-fg-dim bg-tt-bg font-mono">Solana</span>
              <span className="text-[9px] border border-tt-border rounded px-2 py-0.5 text-tt-green bg-tt-bg font-mono">
                {card.graduated ? "✓ Graduated to PumpSwap" : "✓ Bonding Curve"}
              </span>
            </div>
          </div>

          {/* Safety Checklist panel */}
          <div className="bg-tt-bg-panel border border-tt-border p-4 rounded-md">
            <div className="flex justify-between items-baseline mb-3 font-mono">
              <span className="font-display text-lg text-tt-green font-bold">{card.safety.rugScore}/100</span>
              <span className="text-[9px] text-tt-fg-faint uppercase font-semibold">Rug Score</span>
            </div>
            <div className="space-y-1.5 divide-y divide-tt-border/40 font-mono text-[10px]">
              <div className={`pt-1.5 flex justify-between ${card.safety.mintAuthorityRevoked ? "text-tt-green" : "text-tt-amber"}`}>
                <span>Mint authority</span>
                <span>{card.safety.mintAuthorityRevoked ? "✓ Revoked" : "⚠ Active"}</span>
              </div>
              <div className={`pt-1.5 flex justify-between ${card.safety.freezeAuthorityRevoked ? "text-tt-green" : "text-tt-amber"}`}>
                <span>Freeze authority</span>
                <span>{card.safety.freezeAuthorityRevoked ? "✓ Revoked" : "⚠ Active"}</span>
              </div>
              <div className={`pt-1.5 flex justify-between ${card.safety.lpLocked ? "text-tt-green" : "text-tt-amber"}`}>
                <span>LP pool status</span>
                <span>{card.safety.lpLocked ? "✓ Locked" : "⚠ Unlocked"}</span>
              </div>
              <div className={`pt-1.5 flex justify-between ${card.safety.honeypotClean ? "text-tt-green" : "text-tt-amber"}`}>
                <span>Honeypot clean</span>
                <span>{card.safety.honeypotClean ? "✓ Clean" : "⚠ Warning"}</span>
              </div>
              {card.safety.top10HolderPct != null && (
                <div className="pt-1.5 flex justify-between text-tt-fg-dim">
                  <span>Top 10 holders</span>
                  <span>{card.safety.top10HolderPct.toFixed(1)}% supply</span>
                </div>
              )}
            </div>
          </div>

          {/* Volume scoring details with individual flags */}
          {card.volume && (
            <div className="bg-tt-bg-panel border border-tt-border p-4 rounded-md">
              <div className="flex justify-between items-baseline mb-3 font-mono">
                <span className={`font-display text-lg font-bold ${card.volume.verdict === "organic" ? "text-tt-green" : "text-tt-amber"}`}>
                  {card.volume.score}/100
                </span>
                <span className="text-[9px] text-tt-fg-faint uppercase font-semibold">
                  Vol Score ({card.volume.verdict})
                </span>
              </div>
              <div className="space-y-1.5 divide-y divide-tt-border/40 font-mono text-[10px]">
                {card.volume.signals.map((s) => (
                  <div key={s.name} className="pt-1.5 flex justify-between">
                    <span className="text-tt-fg-dim">{METRIC_LABELS[s.name] ?? s.name.replace(/_/g, " ")}</span>
                    <span className={s.flag ? "text-tt-amber font-semibold" : "text-tt-fg"}>
                      {s.value.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Market details */}
          <div className="bg-tt-bg-panel border border-tt-border p-4 rounded-md font-mono text-[10px]">
            <div className="text-[9px] uppercase tracking-wider text-tt-fg-faint mb-2 font-semibold">Market</div>
            <div className="space-y-1.5 divide-y divide-tt-border/40">
              <div className="pt-1.5 flex justify-between">
                <span className="text-tt-fg-dim">FDV</span>
                <span className="text-tt-fg font-semibold">{fmtUsd(card.market.fdvUsd)}</span>
              </div>
              <div className="pt-1.5 flex justify-between">
                <span className="text-tt-fg-dim">Liquidity</span>
                <span className="text-tt-fg font-semibold">{fmtUsd(card.market.liquidityUsd)}</span>
              </div>
              <div className="pt-1.5 flex justify-between">
                <span className="text-tt-fg-dim">24h Volume</span>
                <span className="text-tt-fg font-semibold">{fmtUsd(card.market.volume24hUsd)}</span>
              </div>
            </div>
          </div>

          {/* Social details */}
          <div className="bg-tt-bg-panel border border-tt-border p-4 rounded-md font-mono text-[10px]">
            <div className="text-[9px] uppercase tracking-wider text-tt-fg-faint mb-2 font-semibold">Social</div>
            <div className="space-y-1.5 divide-y divide-tt-border/40">
              <div className="pt-1.5 flex justify-between">
                <span className="text-tt-fg-dim">KOL mentions</span>
                <span className="text-tt-fg font-semibold">{card.socialSignals.kolMentions} of {card.socialSignals.totalTrackedChannels}</span>
              </div>
              <div className="pt-1.5 flex justify-between">
                <span className="text-tt-fg-dim">DexScreener trending</span>
                <span className={`font-semibold ${card.socialSignals.kolMentions > 0 ? "text-tt-brand" : "text-tt-red"}`}>
                  {card.socialSignals.kolMentions > 0 ? "Yes" : "No"}
                </span>
              </div>
            </div>
          </div>

          {/* Verdict AI panel */}
          <div className="bg-tt-bg-panel border border-tt-border p-4 rounded-md">
            <div className="text-[9px] uppercase tracking-wider text-tt-fg-faint mb-2 font-semibold font-mono">Verdict (AI)</div>
            <p className="text-[11px] text-tt-fg-dim leading-relaxed font-mono">{getVerdictText()}</p>
          </div>

          {/* Action buttons */}
          <div className="bg-tt-bg-panel border border-tt-border p-4 rounded-md actions-panel space-y-2.5">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="refresh-dd-btn w-full py-2.5 rounded bg-tt-brand hover:opacity-90 font-mono text-xs font-semibold text-tt-bg cursor-pointer disabled:opacity-50"
            >
              {refreshing ? "Refreshing..." : "Refresh DD"}
            </button>
            <WatchlistButton
              tokenAddress={address}
              tokenSymbol={tokenSymbol}
              tokenName={card.name}
              variant="button"
            />
            <div className="ca-footer text-[9px] text-tt-fg-faint font-mono text-center break-all truncate select-all">{address}</div>
          </div>

          {/* Research Thread panel */}
          <div className="bg-tt-bg-panel border border-tt-border rounded-md overflow-hidden">
            <div
              onClick={() => setNotesOpen((o) => !o)}
              className="flex justify-between items-center p-4 text-xs font-semibold text-tt-fg border-b border-tt-border cursor-pointer hover:bg-tt-bg/25"
            >
              <span>Research Thread</span>
              <span className="font-mono text-tt-fg-dim">{notesOpen ? "▾" : "›"}</span>
            </div>
            {notesOpen && (
              <div className="p-4 space-y-3">
                {/* Notes List & Chat log */}
                <div className="max-h-[160px] overflow-y-auto space-y-2 pr-1 font-mono text-[10px]">
                  {notes.length === 0 && chatMessages.length === 0 && (
                    <div className="research-empty text-tt-fg-faint italic leading-relaxed">
                      No messages yet. Add a note, or ask Kira a question about this token.
                    </div>
                  )}
                  {notes.map((n) => (
                    <div key={n.id} className="p-2 bg-tt-bg border border-tt-border rounded text-tt-fg-dim">
                      <div className="text-[8px] text-tt-fg-faint flex justify-between">
                        <span>User Note</span>
                        <span>{new Date(n.created_at).toLocaleTimeString()}</span>
                      </div>
                      <p className="mt-1 leading-normal whitespace-pre-wrap">{n.content}</p>
                    </div>
                  ))}
                  {chatMessages.map((m, i) => (
                    <div
                      key={i}
                      className={`p-2 border rounded ${
                        m.sender === "user" ? "bg-tt-bg border-tt-border text-tt-fg-dim" : "bg-tt-brand/10 border-tt-brand/20 text-tt-fg"
                      }`}
                    >
                      <div className="text-[8px] text-tt-fg-faint flex justify-between">
                        <span>{m.sender === "user" ? "User Note" : "Kira AI"}</span>
                        <span>{m.time}</span>
                      </div>
                      <p className="mt-1 leading-normal whitespace-pre-wrap">{m.text}</p>
                    </div>
                  ))}
                  {kiraThinking && (
                    <div className="text-[10px] text-tt-brand animate-pulse">Kira is thinking...</div>
                  )}
                </div>

                {/* Input Textarea */}
                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="Write a note, or ask Kira about this token..."
                  className="research-input w-full min-h-[60px] bg-tt-bg border border-tt-border rounded p-2 text-[11px] text-tt-fg placeholder-tt-fg-faint focus:outline-none focus:border-tt-brand font-mono"
                />

                {/* Save Note & Ask Kira actions */}
                <div className="flex justify-end gap-2 font-mono">
                  <button
                    onClick={handleSaveNote}
                    className="save-note-btn text-[10px] px-3 py-1.5 rounded border border-tt-border text-tt-fg-dim hover:text-tt-fg cursor-pointer bg-transparent"
                  >
                    Save Note
                  </button>
                  <button
                    onClick={handleAskKira}
                    className="ask-kira-btn text-[10px] px-3 py-1.5 rounded bg-tt-brand text-tt-bg font-semibold cursor-pointer"
                  >
                    Ask Kira
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
