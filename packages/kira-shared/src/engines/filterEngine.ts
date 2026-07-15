export interface SignalFilter {
  minLiquidityUsd: number | null;
  minFdvUsd: number | null;
  maxFdvUsd: number | null;
  minVolume24h: number | null;
  minHolders: number | null;
  maxAgeHours: number | null;
  launchpads: string[]; // empty = any launchpad
  minRugScore: number | null;
  requireLpLocked: boolean | null;
  requireMintRevoked: boolean | null;
  minVolumeScore: number | null;
  minSocialMindshare: number | null;
  minSocialSentiment: number | null;
  minGalaxyScore: number | null;
  requireRosterWallet: boolean;
  minRosterWallets: number;
}

export interface FilterableTokenSnapshot {
  liquidityUsd: number | null;
  fdvUsd: number | null;
  volume24hUsd: number | null;
  holders: number | null;
  ageHours: number | null;
  launchpad: string;
  rugScore: number | null;
  lpLocked: boolean;
  mintAuthorityRevoked: boolean;
  volumeScore: number | null;
  socialMindshare: number | null;
  socialSentiment: number | null;
  galaxyScore: number | null;
}

/**
 * Pure function, no I/O. Returns true only if every criterion the filter has actually set is
 * met. An unset (null) criterion always passes, that is what "optional and combinable" means.
 *
 * Two different null-handling rules by design:
 * - On-chain / volume criteria: if the filter sets a minimum but the token's own value is null
 *   (data we should reliably have from RugCheck/DexScreener/the volume engine), the criterion
 *   FAILS. Missing core data is treated as not meeting the bar, not as "unknown, so pass."
 * - Social criteria: if the filter sets a minimum but the token has no social data (LunarCrush
 *   returns null constantly for brand-new tokens), the criterion is SKIPPED rather than failed,
 *   per the PRD's explicit "skip gracefully when it does not exist" requirement (Section 14,
 *   Sprint 5 acceptance criterion 8). A filter with only social criteria set should not become
 *   permanently unmatchable just because social data usually isn't there yet.
 */
export function evaluateSignalFilter(
  filter: SignalFilter,
  token: FilterableTokenSnapshot,
  rosterWalletCount: number,
): boolean {
  if (filter.minLiquidityUsd != null) {
    if (token.liquidityUsd == null || token.liquidityUsd < filter.minLiquidityUsd) return false;
  }
  if (filter.minFdvUsd != null) {
    if (token.fdvUsd == null || token.fdvUsd < filter.minFdvUsd) return false;
  }
  if (filter.maxFdvUsd != null) {
    if (token.fdvUsd == null || token.fdvUsd > filter.maxFdvUsd) return false;
  }
  if (filter.minVolume24h != null) {
    if (token.volume24hUsd == null || token.volume24hUsd < filter.minVolume24h) return false;
  }
  if (filter.minHolders != null) {
    if (token.holders == null || token.holders < filter.minHolders) return false;
  }
  if (filter.maxAgeHours != null) {
    if (token.ageHours == null || token.ageHours > filter.maxAgeHours) return false;
  }
  if (filter.launchpads.length > 0) {
    if (!filter.launchpads.includes(token.launchpad)) return false;
  }
  if (filter.minRugScore != null) {
    if (token.rugScore == null || token.rugScore < filter.minRugScore) return false;
  }
  if (filter.requireLpLocked) {
    if (!token.lpLocked) return false;
  }
  if (filter.requireMintRevoked) {
    if (!token.mintAuthorityRevoked) return false;
  }
  if (filter.minVolumeScore != null) {
    if (token.volumeScore == null || token.volumeScore < filter.minVolumeScore) return false;
  }

  // Social criteria: skip (treat as passed) when the token has no social data at all.
  if (filter.minSocialMindshare != null && token.socialMindshare != null) {
    if (token.socialMindshare < filter.minSocialMindshare) return false;
  }
  if (filter.minSocialSentiment != null && token.socialSentiment != null) {
    if (token.socialSentiment < filter.minSocialSentiment) return false;
  }
  if (filter.minGalaxyScore != null && token.galaxyScore != null) {
    if (token.galaxyScore < filter.minGalaxyScore) return false;
  }

  if (filter.requireRosterWallet) {
    if (rosterWalletCount < filter.minRosterWallets) return false;
  }

  return true;
}
