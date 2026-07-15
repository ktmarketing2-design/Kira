export interface VolumeInput {
  fdvUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
  swaps: Array<{
    wallet: string;
    side: "buy" | "sell";
    usdValue: number;
    timestamp: number; // unix epoch ms
  }>;
  sampledBuyerWalletAgesDays: number[]; // sample of 30 max
}

export interface VolumeSignal {
  name: string;
  value: number;
  threshold: string;
  flag: boolean;
  weight: number;
}

export interface VolumeOutput {
  score: number; // 0-100
  verdict: "organic" | "mixed" | "likely_paid" | "wash";
  signals: VolumeSignal[];
}

function stddev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function isRoundNumber(value: number): boolean {
  if (value <= 0) return false;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const nearest = Math.round(value / magnitude) * magnitude;
  if (nearest === 0) return false;
  return Math.abs(value - nearest) / value <= 0.02;
}

export function scoreVolume(input: VolumeInput): VolumeOutput {
  const signals: VolumeSignal[] = [];
  let deduction = 0;

  // 1. Vol/Liq ratio 24h — weight 30
  const volLiqRatio = input.liquidityUsd > 0 ? input.volume24hUsd / input.liquidityUsd : 0;
  let volLiqPenalty = 0;
  if (volLiqRatio > 20) volLiqPenalty = 30;
  else if (volLiqRatio >= 5) volLiqPenalty = 15;
  signals.push({
    name: "vol_liq_ratio",
    value: volLiqRatio,
    threshold: "<5x none, 5-20x soft, >20x hard",
    flag: volLiqPenalty > 0,
    weight: 30,
  });
  deduction += volLiqPenalty;

  // 2. Wallet diversity (unique buyers / unique sellers) — weight 20
  const uniqueBuyers = new Set(
    input.swaps.filter((s) => s.side === "buy").map((s) => s.wallet),
  ).size;
  const uniqueSellers = new Set(
    input.swaps.filter((s) => s.side === "sell").map((s) => s.wallet),
  ).size;
  const walletDiversityRatio =
    uniqueSellers > 0 ? uniqueBuyers / uniqueSellers : uniqueBuyers > 0 ? Infinity : 0;
  let diversityPenalty = 0;
  if (walletDiversityRatio < 0.3) diversityPenalty = 20;
  else if (walletDiversityRatio <= 0.7) diversityPenalty = 10;
  signals.push({
    name: "wallet_diversity",
    value: Number.isFinite(walletDiversityRatio) ? walletDiversityRatio : -1,
    threshold: ">0.7 none, 0.3-0.7 soft, <0.3 hard",
    flag: diversityPenalty > 0,
    weight: 20,
  });
  deduction += diversityPenalty;

  // 3. Timing entropy (std dev of intervals between swaps, seconds) — weight 20
  const sortedTimestamps = [...input.swaps.map((s) => s.timestamp)].sort((a, b) => a - b);
  const intervalsSec: number[] = [];
  for (let i = 1; i < sortedTimestamps.length; i++) {
    intervalsSec.push((sortedTimestamps[i] - sortedTimestamps[i - 1]) / 1000);
  }
  const timingStdDev = stddev(intervalsSec);
  const timingFlag = intervalsSec.length > 0 && timingStdDev < 30;
  signals.push({
    name: "timing_entropy",
    value: timingStdDev,
    threshold: "flag if std dev < 30s",
    flag: timingFlag,
    weight: 20,
  });
  deduction += timingFlag ? 20 : 0;

  // 4. New wallet ratio (< 7 days old / sample size) — weight 15
  const sample = input.sampledBuyerWalletAgesDays;
  const newWalletRatio =
    sample.length > 0 ? sample.filter((days) => days < 7).length / sample.length : 0;
  let newWalletPenalty = 0;
  if (newWalletRatio > 0.5) newWalletPenalty = 15;
  else if (newWalletRatio >= 0.2) newWalletPenalty = 7.5;
  signals.push({
    name: "new_wallet_ratio",
    value: newWalletRatio,
    threshold: "<20% none, 20-50% soft, >50% hard",
    flag: newWalletPenalty > 0,
    weight: 15,
  });
  deduction += newWalletPenalty;

  // 5. FDV/Liq ratio — weight 10
  const fdvLiqRatio = input.liquidityUsd > 0 ? input.fdvUsd / input.liquidityUsd : 0;
  let fdvLiqPenalty = 0;
  if (fdvLiqRatio > 200) fdvLiqPenalty = 10;
  else if (fdvLiqRatio >= 50) fdvLiqPenalty = 5;
  signals.push({
    name: "fdv_liq_ratio",
    value: fdvLiqRatio,
    threshold: "<50x none, 50-200x soft, >200x hard",
    flag: fdvLiqPenalty > 0,
    weight: 10,
  });
  deduction += fdvLiqPenalty;

  // 6. Round-size prevalence (% swaps within ±2% of a round USD value) — weight 5
  const roundCount = input.swaps.filter((s) => isRoundNumber(s.usdValue)).length;
  const roundPrevalence = input.swaps.length > 0 ? roundCount / input.swaps.length : 0;
  const roundFlag = roundPrevalence > 0.4;
  signals.push({
    name: "round_size_prevalence",
    value: roundPrevalence,
    threshold: "<20% none, >40% flag",
    flag: roundFlag,
    weight: 5,
  });
  deduction += roundFlag ? 5 : 0;

  const score = Math.max(0, Math.min(100, Math.round(100 - deduction)));

  let verdict: VolumeOutput["verdict"];
  if (score >= 80) verdict = "organic";
  else if (score >= 50) verdict = "mixed";
  else if (score >= 20) verdict = "likely_paid";
  else verdict = "wash";

  return { score, verdict, signals };
}
