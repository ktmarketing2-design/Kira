export interface ClusterMember {
  walletAddress: string;
  timestamp: number; // unix epoch ms
  usdValue: number;
  side: "buy" | "sell";
}

export interface ClusterSettings {
  threshold: number; // min wallets to trigger (2 or 3)
  windowMinutes: number; // time window
  minUsdPerBuy: number; // minimum buy size to count
}

export interface ClusterResult {
  fires: boolean;
  triggeringWallets: string[];
  firstMover: string | null;
  totalUsd: number;
  windowMinutes: number;
}

export function evaluateCluster(
  members: ClusterMember[],
  userRosterAddresses: string[],
  settings: ClusterSettings,
): ClusterResult {
  const rosterSet = new Set(userRosterAddresses);

  // Only wallets the user actually tracks count toward their cluster.
  const inRoster = members.filter((m) => rosterSet.has(m.walletAddress));

  // Buys below the minimum size don't count; sells are unaffected by this floor.
  const sizeFiltered = inRoster.filter((m) => m.side !== "buy" || m.usdValue >= settings.minUsdPerBuy);

  if (sizeFiltered.length === 0) {
    return { fires: false, triggeringWallets: [], firstMover: null, totalUsd: 0, windowMinutes: settings.windowMinutes };
  }

  // Window is anchored to the most recent event in the filtered set.
  const mostRecentTs = Math.max(...sizeFiltered.map((m) => m.timestamp));
  const windowMs = settings.windowMinutes * 60_000;
  const inWindow = sizeFiltered.filter((m) => mostRecentTs - m.timestamp <= windowMs);

  const uniqueWallets = Array.from(new Set(inWindow.map((m) => m.walletAddress)));
  const fires = uniqueWallets.length >= settings.threshold;

  const totalUsd = inWindow.reduce((sum, m) => sum + m.usdValue, 0);

  const firstMover = inWindow.reduce<ClusterMember | null>((earliest, m) => {
    if (!earliest || m.timestamp < earliest.timestamp) return m;
    return earliest;
  }, null);

  return {
    fires,
    triggeringWallets: uniqueWallets,
    firstMover: firstMover ? firstMover.walletAddress : null,
    totalUsd,
    windowMinutes: settings.windowMinutes,
  };
}
