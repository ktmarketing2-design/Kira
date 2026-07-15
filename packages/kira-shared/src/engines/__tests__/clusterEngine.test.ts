import { describe, expect, it } from "vitest";
import { evaluateCluster, type ClusterMember, type ClusterSettings } from "../clusterEngine.js";

const baseTs = Date.parse("2026-06-01T00:00:00Z");
const minutes = (n: number) => n * 60_000;

describe("evaluateCluster", () => {
  it("fires when 3 roster wallets buy the same token within a 2h window, all above minUsd", () => {
    const members: ClusterMember[] = [
      { walletAddress: "walletA", timestamp: baseTs, usdValue: 500, side: "buy" },
      { walletAddress: "walletB", timestamp: baseTs + minutes(30), usdValue: 800, side: "buy" },
      { walletAddress: "walletC", timestamp: baseTs + minutes(90), usdValue: 1200, side: "buy" },
    ];
    const settings: ClusterSettings = { threshold: 3, windowMinutes: 120, minUsdPerBuy: 100 };

    const result = evaluateCluster(members, ["walletA", "walletB", "walletC"], settings);

    expect(result.fires).toBe(true);
    expect(result.triggeringWallets.sort()).toEqual(["walletA", "walletB", "walletC"]);
    expect(result.totalUsd).toBe(2500);
  });

  it("does not fire with only 2 wallets when threshold is 3", () => {
    const members: ClusterMember[] = [
      { walletAddress: "walletA", timestamp: baseTs, usdValue: 500, side: "buy" },
      { walletAddress: "walletB", timestamp: baseTs + minutes(30), usdValue: 800, side: "buy" },
    ];
    const settings: ClusterSettings = { threshold: 3, windowMinutes: 120, minUsdPerBuy: 100 };

    const result = evaluateCluster(members, ["walletA", "walletB"], settings);

    expect(result.fires).toBe(false);
  });

  it("identifies firstMover as the earliest timestamp among triggering wallets", () => {
    const members: ClusterMember[] = [
      { walletAddress: "walletC", timestamp: baseTs + minutes(90), usdValue: 1200, side: "buy" },
      { walletAddress: "walletA", timestamp: baseTs, usdValue: 500, side: "buy" },
      { walletAddress: "walletB", timestamp: baseTs + minutes(30), usdValue: 800, side: "buy" },
    ];
    const settings: ClusterSettings = { threshold: 2, windowMinutes: 120, minUsdPerBuy: 100 };

    const result = evaluateCluster(members, ["walletA", "walletB", "walletC"], settings);

    expect(result.firstMover).toBe("walletA");
  });

  it("ignores wallets that are not in the user's roster", () => {
    const members: ClusterMember[] = [
      { walletAddress: "walletA", timestamp: baseTs, usdValue: 500, side: "buy" },
      { walletAddress: "walletB", timestamp: baseTs + minutes(10), usdValue: 800, side: "buy" },
      { walletAddress: "strangerX", timestamp: baseTs + minutes(20), usdValue: 5000, side: "buy" },
    ];
    const settings: ClusterSettings = { threshold: 3, windowMinutes: 120, minUsdPerBuy: 100 };

    const result = evaluateCluster(members, ["walletA", "walletB"], settings);

    expect(result.fires).toBe(false);
    expect(result.triggeringWallets).not.toContain("strangerX");
    expect(result.triggeringWallets.sort()).toEqual(["walletA", "walletB"]);
  });

  it("excludes buys below minUsdPerBuy", () => {
    const members: ClusterMember[] = [
      { walletAddress: "walletA", timestamp: baseTs, usdValue: 500, side: "buy" },
      { walletAddress: "walletB", timestamp: baseTs + minutes(10), usdValue: 800, side: "buy" },
      { walletAddress: "walletC", timestamp: baseTs + minutes(20), usdValue: 50, side: "buy" }, // below floor
    ];
    const settings: ClusterSettings = { threshold: 3, windowMinutes: 120, minUsdPerBuy: 100 };

    const result = evaluateCluster(members, ["walletA", "walletB", "walletC"], settings);

    expect(result.fires).toBe(false);
    expect(result.triggeringWallets).not.toContain("walletC");
  });

  it("drops events outside the time window anchored to the most recent event", () => {
    const members: ClusterMember[] = [
      { walletAddress: "walletA", timestamp: baseTs, usdValue: 500, side: "buy" }, // too old
      { walletAddress: "walletB", timestamp: baseTs + minutes(200), usdValue: 800, side: "buy" },
      { walletAddress: "walletC", timestamp: baseTs + minutes(210), usdValue: 900, side: "buy" },
    ];
    const settings: ClusterSettings = { threshold: 3, windowMinutes: 120, minUsdPerBuy: 100 };

    const result = evaluateCluster(members, ["walletA", "walletB", "walletC"], settings);

    expect(result.fires).toBe(false);
    expect(result.triggeringWallets).not.toContain("walletA");
  });
});
