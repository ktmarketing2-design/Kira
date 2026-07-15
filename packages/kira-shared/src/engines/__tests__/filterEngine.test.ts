import { describe, expect, it } from "vitest";
import { evaluateSignalFilter, type SignalFilter, type FilterableTokenSnapshot } from "../filterEngine.js";

const NULL_FILTER: SignalFilter = {
  minLiquidityUsd: null,
  minFdvUsd: null,
  maxFdvUsd: null,
  minVolume24h: null,
  minHolders: null,
  maxAgeHours: null,
  launchpads: [],
  minRugScore: null,
  requireLpLocked: null,
  requireMintRevoked: null,
  minVolumeScore: null,
  minSocialMindshare: null,
  minSocialSentiment: null,
  minGalaxyScore: null,
  requireRosterWallet: false,
  minRosterWallets: 1,
};

const FULL_FILTER: SignalFilter = {
  ...NULL_FILTER,
  minLiquidityUsd: 10_000,
  minFdvUsd: 50_000,
  maxFdvUsd: 5_000_000,
  minVolume24h: 20_000,
  minHolders: 100,
  maxAgeHours: 48,
  launchpads: ["pumpfun", "raydium"],
  minRugScore: 60,
  requireLpLocked: true,
  requireMintRevoked: true,
  minVolumeScore: 50,
  minSocialMindshare: 10,
  minSocialSentiment: 5,
  minGalaxyScore: 40,
  requireRosterWallet: true,
  minRosterWallets: 2,
};

const MATCHING_TOKEN: FilterableTokenSnapshot = {
  liquidityUsd: 50_000,
  fdvUsd: 1_000_000,
  volume24hUsd: 100_000,
  holders: 500,
  ageHours: 12,
  launchpad: "pumpfun",
  rugScore: 85,
  lpLocked: true,
  mintAuthorityRevoked: true,
  volumeScore: 70,
  socialMindshare: 25,
  socialSentiment: 7,
  galaxyScore: 60,
};

describe("evaluateSignalFilter", () => {
  it("returns true when every criterion is met", () => {
    expect(evaluateSignalFilter(FULL_FILTER, MATCHING_TOKEN, 3)).toBe(true);
  });

  it("returns false when one criterion fails, others still match", () => {
    const tooLowLiquidity: FilterableTokenSnapshot = { ...MATCHING_TOKEN, liquidityUsd: 100 };
    expect(evaluateSignalFilter(FULL_FILTER, tooLowLiquidity, 3)).toBe(false);
  });

  it("returns false when rug score is below the minimum", () => {
    const belowRugScore: FilterableTokenSnapshot = { ...MATCHING_TOKEN, rugScore: 40 };
    expect(evaluateSignalFilter(FULL_FILTER, belowRugScore, 3)).toBe(false);
  });

  it("returns false when launchpad is not in the allowed list", () => {
    const wrongLaunchpad: FilterableTokenSnapshot = { ...MATCHING_TOKEN, launchpad: "bags" };
    expect(evaluateSignalFilter(FULL_FILTER, wrongLaunchpad, 3)).toBe(false);
  });

  it("null/unset criteria are always skipped (all-null filter matches anything)", () => {
    const junkToken: FilterableTokenSnapshot = {
      liquidityUsd: null,
      fdvUsd: null,
      volume24hUsd: null,
      holders: null,
      ageHours: null,
      launchpad: "unknown",
      rugScore: null,
      lpLocked: false,
      mintAuthorityRevoked: false,
      volumeScore: null,
      socialMindshare: null,
      socialSentiment: null,
      galaxyScore: null,
    };
    expect(evaluateSignalFilter(NULL_FILTER, junkToken, 0)).toBe(true);
  });

  it("fails a set on-chain criterion when the token's own value is missing", () => {
    const missingRugScore: FilterableTokenSnapshot = { ...MATCHING_TOKEN, rugScore: null };
    const filter: SignalFilter = { ...NULL_FILTER, minRugScore: 60 };
    expect(evaluateSignalFilter(filter, missingRugScore, 0)).toBe(false);
  });

  it("skips (does not fail) a set social criterion when the token has no social data", () => {
    const noSocialData: FilterableTokenSnapshot = {
      ...MATCHING_TOKEN,
      socialMindshare: null,
      socialSentiment: null,
      galaxyScore: null,
    };
    const filter: SignalFilter = {
      ...NULL_FILTER,
      minSocialMindshare: 10,
      minSocialSentiment: 5,
      minGalaxyScore: 40,
    };
    expect(evaluateSignalFilter(filter, noSocialData, 0)).toBe(true);
  });

  it("roster overlay: fails when required but not enough roster wallets are buying", () => {
    const filter: SignalFilter = { ...NULL_FILTER, requireRosterWallet: true, minRosterWallets: 2 };
    expect(evaluateSignalFilter(filter, MATCHING_TOKEN, 1)).toBe(false);
    expect(evaluateSignalFilter(filter, MATCHING_TOKEN, 2)).toBe(true);
  });

  it("roster overlay: ignored when require_roster_wallet is false", () => {
    const filter: SignalFilter = { ...NULL_FILTER, requireRosterWallet: false, minRosterWallets: 5 };
    expect(evaluateSignalFilter(filter, MATCHING_TOKEN, 0)).toBe(true);
  });
});
