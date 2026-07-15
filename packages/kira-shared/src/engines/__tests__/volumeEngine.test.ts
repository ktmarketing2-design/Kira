import { describe, expect, it } from "vitest";
import { scoreVolume, type VolumeInput } from "../volumeEngine.js";

function buildSwaps(opts: {
  buyWallets: number;
  sellWallets: number;
  buysPerWallet: number;
  roundFraction: number;
  intervalsSec: number[]; // cycled to build timestamps between consecutive swaps
}): VolumeInput["swaps"] {
  const swaps: VolumeInput["swaps"] = [];
  const baseTs = Date.parse("2026-06-01T00:00:00Z");

  for (let b = 0; b < opts.buyWallets; b++) {
    for (let i = 0; i < opts.buysPerWallet; i++) {
      swaps.push({ wallet: `buyer${b}`, side: "buy", usdValue: 0, timestamp: 0 });
    }
  }
  for (let s = 0; s < opts.sellWallets; s++) {
    swaps.push({ wallet: `seller${s}`, side: "sell", usdValue: 0, timestamp: 0 });
  }

  let cursor = baseTs;
  // Round exactly `roundFraction * 10` swaps out of every 10, by index position.
  const roundPerTen = Math.round(opts.roundFraction * 10);
  // Values that are exact multiples of their own decade magnitude (so isRoundNumber
  // in the engine reliably treats them as round: 100 -> magnitude 100, 5000 -> magnitude 1000, etc).
  const ROUND_POOL = [100, 200, 500, 1000, 2000, 5000];

  swaps.forEach((swap, i) => {
    cursor += opts.intervalsSec[i % opts.intervalsSec.length] * 1000;
    swap.timestamp = cursor;
    const isRound = i % 10 < roundPerTen;
    const base = ROUND_POOL[i % ROUND_POOL.length];
    // Non-round values are offset by a non-round multiplier so they land well outside
    // the engine's +-2% round-number window regardless of magnitude.
    swap.usdValue = isRound ? base : base * 1.1337 + 7;
  });

  return swaps;
}

describe("scoreVolume", () => {
  it("flags a known wash-traded fixture as wash with a low score", () => {
    const input: VolumeInput = {
      fdvUsd: 1_000_000,
      liquidityUsd: 4_000,
      volume24hUsd: 180_000, // 45x vol/liq
      swaps: buildSwaps({
        buyWallets: 3,
        sellWallets: 15,
        buysPerWallet: 5,
        roundFraction: 0.8, // 80% round-value swaps
        intervalsSec: [8], // tight bot rhythm, near-zero variance
      }),
      sampledBuyerWalletAgesDays: [...Array(27).fill(2), 30, 45, 60], // 90% under 7 days
    };

    const result = scoreVolume(input);

    expect(result.score).toBeLessThan(25);
    expect(result.verdict).toBe("wash");
  });

  it("scores a known organic fixture as organic with a high score", () => {
    const gaps = [50, 4000, 120, 9000, 300, 15000, 60, 20000, 900, 6000];
    const input: VolumeInput = {
      fdvUsd: 1_000_000,
      liquidityUsd: 50_000,
      volume24hUsd: 150_000, // 3x vol/liq
      swaps: buildSwaps({
        buyWallets: 120,
        sellWallets: 110,
        buysPerWallet: 1,
        roundFraction: 0.1, // 10% round-value swaps
        intervalsSec: gaps, // wide, varied gaps -> high timing variance
      }),
      sampledBuyerWalletAgesDays: [...Array(3).fill(2), ...Array(27).fill(90)], // 10% under 7 days
    };

    const result = scoreVolume(input);

    expect(result.score).toBeGreaterThan(75);
    expect(result.verdict).toBe("organic");
  });

  it("scores a mixed fixture with moderate signals as mixed", () => {
    const gaps = [400, 900, 250, 1200, 500];
    const input: VolumeInput = {
      fdvUsd: 300_000,
      liquidityUsd: 10_000,
      volume24hUsd: 100_000, // 10x vol/liq -> soft flag
      swaps: buildSwaps({
        buyWallets: 10,
        sellWallets: 20, // ratio 0.5 -> soft flag
        buysPerWallet: 3,
        roundFraction: 0.1,
        intervalsSec: gaps,
      }),
      sampledBuyerWalletAgesDays: [...Array(10).fill(2), ...Array(20).fill(90)], // 33% -> soft flag
    };

    const result = scoreVolume(input);

    expect(result.verdict).toBe("mixed");
    expect(result.score).toBeGreaterThanOrEqual(50);
    expect(result.score).toBeLessThan(80);
  });

  it("returns all six signals with their fixed weights", () => {
    const result = scoreVolume({
      fdvUsd: 100_000,
      liquidityUsd: 20_000,
      volume24hUsd: 40_000,
      swaps: [],
      sampledBuyerWalletAgesDays: [],
    });

    expect(result.signals.map((s) => s.name)).toEqual([
      "vol_liq_ratio",
      "wallet_diversity",
      "timing_entropy",
      "new_wallet_ratio",
      "fdv_liq_ratio",
      "round_size_prevalence",
    ]);
    expect(result.signals.reduce((sum, s) => sum + s.weight, 0)).toBe(100);
  });
});
