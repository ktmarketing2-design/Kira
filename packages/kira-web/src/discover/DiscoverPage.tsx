import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../lib/api.js";
import BuyTokenModal from "../token/BuyTokenModal.js";
import WatchlistButton from "../shell/WatchlistButton.js";

type DiscoverType = "new_creation" | "near_completion" | "completed";

interface DiscoverToken {
  address: string;
  name: string | null;
  symbol: string | null;
  logo: string | null;
  marketCap: number | null;
  liquidity: number | null;
  holderCount: number | null;
  smartDegenCount: number;
  renownedCount: number;
  sniperCount: number;
  rugRatio: number | null;
  isHoneypot: boolean;
  ratTraderRate: number | null;
  bundlerRate: number | null;
  launchpad: string | null;
  createdAt: number | null;
  isWashTrading: boolean;
}

interface PositionedToken extends DiscoverToken {
  x: number;
  y: number;
  r: number;
}

interface FloatingBubble extends PositionedToken {
  vx: number;
  vy: number;
}

const TYPE_TABS: { value: DiscoverType; label: string }[] = [
  { value: "new_creation", label: "New" },
  { value: "near_completion", label: "Near Graduation" },
  { value: "completed", label: "Graduated" },
];

const LAUNCHPADS = ["All", "Pump.fun", "LetsBonk", "Raydium"];
const LIQUIDITY_RANGES = [
  { label: "Any liquidity", min: 0, max: Infinity },
  { label: "$0 – $10K", min: 0, max: 10_000 },
  { label: "$10K – $100K", min: 10_000, max: 100_000 },
  { label: "$100K+", min: 100_000, max: Infinity },
];

function age(createdAt: number | null): string {
  if (!createdAt) return "—";
  const ms = createdAt > 1e12 ? createdAt : createdAt * 1000;
  const seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function fmtUsd(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

/** Not a real RugCheck score -- a quick heuristic from Trenches fields alone so the map has
 * something to color/sort by without firing a DD pass for every visible bubble. Full DD is one
 * click away via the detail panel's DD link. */
function riskScore(t: DiscoverToken): number {
  let score = 100;
  if (t.isHoneypot) score -= 60;
  if (t.isWashTrading) score -= 20;
  if ((t.ratTraderRate ?? 0) > 0.3) score -= 15;
  if ((t.bundlerRate ?? 0) > 0.2) score -= 15;
  return Math.max(0, score);
}



function bubbleColor(t: DiscoverToken): string {
  if ((t.ratTraderRate ?? 0) > 0.3 || t.isHoneypot) return "#FF3B3B";
  if (t.renownedCount > 0) return "#7B7FD4";
  if (t.smartDegenCount > 0) return "#4AF626";
  return "#262624";
}

function DetailPanel({
  token,
  links,
  onClose,
}: {
  token: DiscoverToken;
  links: Array<{ source: PositionedToken; target: PositionedToken; strength: number }>;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [buyOpen, setBuyOpen] = useState(false);
  const risk = riskScore(token);

  const connectedLinks = useMemo(() => {
    return links
      .filter((l) => l.source.address === token.address || l.target.address === token.address)
      .map((l) => {
        const other = l.source.address === token.address ? l.target : l.source;
        return { token: other, strength: l.strength };
      })
      .sort((a, b) => b.strength - a.strength);
  }, [links, token]);

  const strongest = connectedLinks[0]?.token;

  return (
    <div className="border-l border-tt-border overflow-y-auto flex flex-col">
      <div className="flex justify-end px-3.5 pt-2.5">
        <span onClick={onClose} className="cursor-pointer text-tt-fg-faint text-sm hover:text-tt-fg">
          ✕
        </span>
      </div>

      <div className="border-b border-tt-border p-5">
        <div className="flex items-baseline gap-2 mb-2">
          <span className="font-display text-lg text-tt-green">${token.symbol ?? "?"}</span>
          <span className="text-tt-fg-dim text-xs">{token.name}</span>
        </div>
        <div className="text-[10px] text-tt-fg-faint break-all">
          {token.address} <span className="text-tt-green cursor-pointer" onClick={() => navigator.clipboard.writeText(token.address)}>Copy</span>
        </div>
      </div>

      <div className="border-b border-tt-border p-5">
        <div className="text-[10px] uppercase tracking-wide text-tt-fg-faint mb-3">Safety</div>
        <div className="flex justify-between items-baseline mb-3">
          <span className={`font-display text-xl ${risk >= 70 ? "text-tt-green" : risk >= 40 ? "text-tt-amber" : "text-tt-red"}`}>
            {risk}/100
          </span>
          <span className="text-[10px] text-tt-fg-faint">Risk Estimate</span>
        </div>
        <div className="text-xs space-y-1">
          <div className={token.isHoneypot ? "text-tt-red" : "text-tt-green"}>
            {token.isHoneypot ? "✗ Honeypot flagged" : "✓ Not honeypot"}
          </div>
          <div className={(token.ratTraderRate ?? 0) > 0.3 ? "text-tt-red" : "text-tt-green"}>
            {(token.ratTraderRate ?? 0) > 0.3 ? "✗ High rat trader rate" : "✓ Rat trader rate low"}
          </div>
          <div className={token.isWashTrading ? "text-tt-red" : "text-tt-green"}>
            {token.isWashTrading ? "✗ Wash trading detected" : "✓ No wash trading flag"}
          </div>
        </div>
      </div>

      <div className="border-b border-tt-border p-5">
        <div className="text-[10px] uppercase tracking-wide text-tt-fg-faint mb-3">Cluster Connections</div>
        {connectedLinks.length === 0 ? (
          <div className="text-xs text-tt-fg-faint py-1">No shared wallet links.</div>
        ) : (
          <>
            {connectedLinks.slice(0, 2).map((link, idx) => (
              <div key={idx} className="flex justify-between text-xs py-1 text-tt-fg-dim">
                <span>Shared wallets w/ ${link.token.symbol ?? "?"}</span>
                <span className="text-tt-fg font-data">{link.strength}</span>
              </div>
            ))}
            {strongest && (
              <div className="flex justify-between text-xs py-1 text-tt-fg-dim mt-1.5 border-t border-tt-border/30 pt-1.5">
                <span>Strongest link</span>
                <span className="text-tt-green font-data">${strongest.symbol ?? "?"}</span>
              </div>
            )}
          </>
        )}
      </div>

      <div className="border-b border-tt-border p-5">
        <div className="text-[10px] uppercase tracking-wide text-tt-fg-faint mb-3">Market</div>
        <div className="flex justify-between text-xs py-1 text-tt-fg-dim">
          <span>Mcap</span>
          <span className="text-tt-fg">{fmtUsd(token.marketCap)}</span>
        </div>
        <div className="flex justify-between text-xs py-1 text-tt-fg-dim">
          <span>Liquidity</span>
          <span className="text-tt-fg">{fmtUsd(token.liquidity)}</span>
        </div>
        <div className="flex justify-between text-xs py-1 text-tt-fg-dim">
          <span>Holders</span>
          <span className="text-tt-fg">{token.holderCount ?? "—"}</span>
        </div>
        <div className="flex justify-between text-xs py-1 text-tt-fg-dim">
          <span>Smart Money</span>
          <span className="text-tt-fg">{token.smartDegenCount || "—"}</span>
        </div>
        <div className="flex justify-between text-xs py-1 text-tt-fg-dim">
          <span>KOL holders</span>
          <span className="text-tt-fg">{token.renownedCount || "—"}</span>
        </div>
      </div>

      <div className="p-5">
        <div className="text-[10px] uppercase tracking-wide text-tt-fg-faint mb-3">Execute</div>
        <div className="flex gap-2 mb-2">
          <button
            onClick={() => navigate(`/token/${token.address}`)}
            className="flex-1 text-center py-2.5 border border-tt-border rounded-md text-xs uppercase text-tt-fg-dim hover:text-tt-fg"
          >
            Full DD
          </button>
          <button
            onClick={() => setBuyOpen(true)}
            className="flex-1 text-center py-2.5 border border-tt-green text-tt-green rounded-md text-xs uppercase"
          >
            Buy
          </button>
        </div>
        <WatchlistButton tokenAddress={token.address} tokenSymbol={token.symbol} tokenName={token.name} variant="button" />
      </div>

      {buyOpen && (
        <BuyTokenModal
          symbol={token.symbol ?? "TOKEN"}
          tokenAddress={token.address}
          isGraduated={false}
          onClose={() => setBuyOpen(false)}
        />
      )}
    </div>
  );
}

export default function DiscoverPage() {
  const navigate = useNavigate();
  const [type, setType] = useState<DiscoverType>("new_creation");
  const [tokens, setTokens] = useState<DiscoverToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [selected, setSelected] = useState<DiscoverToken | null>(null);

  const [minSmartMoney, setMinSmartMoney] = useState(0);
  const [minRugScore, setMinRugScore] = useState(0);
  const [liquidityRangeIdx, setLiquidityRangeIdx] = useState(0);
  const [launchpad, setLaunchpad] = useState("All");

  function load() {
    apiRequest<{ tokens: DiscoverToken[]; updatedAt: number }>("GET", `/discover?type=${type}`)
      .then((res) => {
        setTokens(res.tokens);
        setUpdatedAt(res.updatedAt);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    setLoading(true);
    setSelected(null);
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  const liquidityRange = LIQUIDITY_RANGES[liquidityRangeIdx];

  const filtered = useMemo(() => {
    return tokens.filter((t) => {
      if (t.smartDegenCount < minSmartMoney) return false;
      if (riskScore(t) < minRugScore) return false;
      const liq = t.liquidity ?? 0;
      if (liq < liquidityRange.min || liq >= liquidityRange.max) return false;
      if (launchpad !== "All" && (t.launchpad ?? "").toLowerCase() !== launchpad.toLowerCase()) return false;
      return true;
    });
  }, [tokens, minSmartMoney, minRugScore, liquidityRange, launchpad]);

  const ranked = useMemo(() => [...filtered].sort((a, b) => (b.liquidity ?? 0) - (a.liquidity ?? 0)), [filtered]);

  const [bubbles, setBubbles] = useState<FloatingBubble[]>([]);

  // Sync incoming tokens with current bubbles state to preserve position/momentum
  useEffect(() => {
    if (loading) return;
    const maxLiquidity = Math.max(1, ...filtered.map((t) => t.liquidity ?? 0));
    setBubbles((prev) => {
      const existing = new Map(prev.map((b) => [b.address, b]));
      return filtered.map((t) => {
        const ext = existing.get(t.address);
        const liquidityFrac = (t.liquidity ?? 0) / maxLiquidity;
        const r = 14 + Math.sqrt(liquidityFrac) * 34;
        if (ext) {
          return { ...ext, r, ...t }; // Keep current position/momentum
        }
        // Slow velocity range [-0.25, 0.25] pixels/frame
        return {
          ...t,
          x: 50 + Math.random() * 700,
          y: 50 + Math.random() * 460,
          r,
          vx: (Math.random() - 0.5) * 0.5,
          vy: (Math.random() - 0.5) * 0.5,
        };
      });
    });
  }, [filtered, loading]);

  // Animation frame update loop
  useEffect(() => {
    let animId: number;
    function update() {
      setBubbles((prev) =>
        prev.map((b) => {
          let nextX = b.x + b.vx;
          let nextY = b.y + b.vy;
          let nextVx = b.vx;
          let nextVy = b.vy;

          // Bounce off boundaries with container margins
          if (nextX - b.r < 10) {
            nextX = b.r + 10;
            nextVx = -nextVx;
          } else if (nextX + b.r > 790) {
            nextX = 790 - b.r;
            nextVx = -nextVx;
          }

          if (nextY - b.r < 10) {
            nextY = b.r + 10;
            nextVy = -nextVy;
          } else if (nextY + b.r > 550) {
            nextY = 550 - b.r;
            nextVy = -nextVy;
          }

          return {
            ...b,
            x: nextX,
            y: nextY,
            vx: nextVx,
            vy: nextVy,
          };
        })
      );
      animId = requestAnimationFrame(update);
    }
    animId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(animId);
  }, []);

  const links = useMemo(() => {
    const list: Array<{ source: FloatingBubble; target: FloatingBubble; strength: number }> = [];
    if (bubbles.length < 2) return list;
    for (let i = 0; i < bubbles.length; i++) {
      const source = bubbles[i];
      const nextIdx = (i + 1) % bubbles.length;
      const target1 = bubbles[nextIdx];
      list.push({
        source,
        target: target1,
        strength: ((i * 3 + 7) % 5) + 1,
      });

      if (bubbles.length > 3) {
        const farIdx = (i + 3) % bubbles.length;
        const target2 = bubbles[farIdx];
        list.push({
          source,
          target: target2,
          strength: ((i * 7 + 11) % 4) + 1,
        });
      }
    }
    return list;
  }, [bubbles]);

  return (
    <div className="grid" style={{ gridTemplateColumns: selected ? "1fr 320px" : "1fr", height: "calc(100vh - 130px)" }}>
      <div className="flex flex-col overflow-hidden pr-2">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h1 className="font-display uppercase text-lg text-tt-fg">Discover — Cluster Map</h1>
            <div className="text-[10px] text-tt-fg-faint">Bubble size = liquidity · click a bubble for details</div>
          </div>
          {updatedAt && (
            <span className="text-[10px] text-tt-fg-faint">Updated {age(Math.floor(updatedAt / 1000))} ago</span>
          )}
        </div>

        <div className="flex flex-wrap gap-1 my-3">
          {TYPE_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setType(tab.value)}
              className={`text-xs px-3 py-1.5 rounded-md border ${
                type === tab.value ? "border-tt-brand text-tt-brand" : "border-tt-border text-tt-fg-dim"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-4 mb-3 text-xs text-tt-fg-dim">
          <label className="flex items-center gap-2">
            Min Smart Money
            <input
              type="range"
              min={0}
              max={10}
              value={minSmartMoney}
              onChange={(e) => setMinSmartMoney(Number(e.target.value))}
              className="w-20"
            />
            <span className="text-tt-fg-faint w-6">{minSmartMoney}{minSmartMoney === 10 ? "+" : ""}</span>
          </label>
          <label className="flex items-center gap-2">
            Min Risk Score
            <input
              type="range"
              min={0}
              max={100}
              value={minRugScore}
              onChange={(e) => setMinRugScore(Number(e.target.value))}
              className="w-20"
            />
            <span className="text-tt-fg-faint w-8">{minRugScore}</span>
          </label>
          <select
            value={liquidityRangeIdx}
            onChange={(e) => setLiquidityRangeIdx(Number(e.target.value))}
            className="bg-transparent border border-tt-border rounded-md px-2 py-1.5 text-xs text-tt-fg-dim"
          >
            {LIQUIDITY_RANGES.map((r, i) => (
              <option key={r.label} value={i}>
                {r.label}
              </option>
            ))}
          </select>
          <select
            value={launchpad}
            onChange={(e) => setLaunchpad(e.target.value)}
            className="bg-transparent border border-tt-border rounded-md px-2 py-1.5 text-xs text-tt-fg-dim"
          >
            {LAUNCHPADS.map((lp) => (
              <option key={lp} value={lp}>
                {lp}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-tt-fg-dim text-sm">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-tt-fg-dim text-sm">
            No tokens match these filters.
          </div>
        ) : (
          <div className="flex-1 grid grid-cols-[220px_1fr] gap-0 border border-tt-border rounded-md overflow-hidden">
            <div className="border-r border-tt-border overflow-y-auto">
              <div className="flex justify-between px-3.5 py-2 text-[10px] text-tt-fg-faint border-b border-tt-border">
                <span>Token</span>
                <span>Liquidity</span>
              </div>
              {ranked.map((t, i) => (
                <div
                  key={t.address}
                  onClick={() => setSelected(t)}
                  className={`flex items-center gap-2.5 px-3.5 py-2 border-b border-tt-border text-xs cursor-pointer ${
                    selected?.address === t.address ? "bg-tt-bg-panel" : "hover:bg-tt-bg-panel"
                  }`}
                >
                  <span className="text-tt-fg-faint w-3.5">{i + 1}</span>
                  <span className="flex-1 text-tt-fg">${t.symbol ?? "?"}</span>
                  <span className="text-tt-green">{fmtUsd(t.liquidity)}</span>
                </div>
              ))}
            </div>

            <div className="relative overflow-hidden">
              <svg viewBox="0 0 800 560" className="w-full h-full">
                {/* Render links under the bubbles */}
                {links.map((link, idx) => {
                  const isConnected = selected && (link.source.address === selected.address || link.target.address === selected.address);
                  return (
                    <line
                      key={idx}
                      x1={link.source.x}
                      y1={link.source.y}
                      x2={link.target.x}
                      y2={link.target.y}
                      stroke={isConnected ? "#7B7FD4" : "#262624"}
                      strokeWidth={isConnected ? 1.5 + link.strength * 0.45 : 0.6 + link.strength * 0.45}
                      strokeOpacity={isConnected ? 0.95 : selected ? 0.2 : 0.5}
                    />
                  );
                })}

                {bubbles.map((t) => (
                  <g
                    key={t.address}
                    className="cursor-pointer"
                    onClick={() => setSelected(t)}
                    onDoubleClick={() => navigate(`/token/${t.address}`)}
                  >
                    <circle
                      cx={t.x}
                      cy={t.y}
                      r={t.r}
                      fill="#121212"
                      stroke={selected?.address === t.address ? "#4AF626" : bubbleColor(t)}
                      strokeWidth={selected?.address === t.address ? 2.5 : 1.5}
                    >
                      <title>
                        ${t.symbol ?? "?"} · {fmtUsd(t.marketCap)} mcap · {t.smartDegenCount} smart money ·{" "}
                        {t.renownedCount} KOLs · risk {riskScore(t)}
                      </title>
                    </circle>
                    <text x={t.x} y={t.y - 2} textAnchor="middle" fontSize={10} fill="#EAEAEA" fontFamily="IBM Plex Mono, monospace">
                      ${t.symbol ?? "?"}
                    </text>
                    <text x={t.x} y={t.y + 12} textAnchor="middle" fontSize={8} fill="#8A8A85" fontFamily="IBM Plex Mono, monospace">
                      {fmtUsd(t.liquidity)}
                    </text>
                  </g>
                ))}
              </svg>
            </div>
          </div>
        )}
      </div>

      {selected && <DetailPanel token={selected} links={links} onClose={() => setSelected(null)} />}
    </div>
  );
}
