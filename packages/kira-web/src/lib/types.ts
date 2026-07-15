export type KiraTier = "scout" | "pro" | "elite" | "studio";

export interface Profile {
  id: string;
  telegram_user_id: number | null;
  telegram_username: string | null;
  tier: KiraTier;
  tier_expires_at: string | null;
}

export interface AlertSettings {
  user_id: string;
  cluster_threshold: number;
  window_minutes: number;
  min_usd_per_buy: number;
  quiet_hours_start: number | null;
  quiet_hours_end: number | null;
  timezone: string;
}

export interface MeResponse {
  profile: Profile | null;
  tier: KiraTier;
  tierExpiresAt: string | null;
  settings: AlertSettings | null;
}

export interface RosterWallet {
  id: string;
  address: string;
  label: string | null;
  created_at: string;
  performance7d: { win_rate: number | null; avg_return_pct: number | null; trades: number } | null;
}

export interface Alert {
  id: string;
  user_id: string;
  type: "cluster_buy" | "cluster_sell" | "new_token_cluster" | "signal_filter_match";
  token_address: string;
  token_symbol: string | null;
  wallet_addresses: string[];
  wallet_count: number;
  total_usd: number | null;
  window_minutes: number;
  first_buyer_address: string | null;
  dd_score: number | null;
  volume_score: number | null;
  delivered_telegram: boolean;
  delivered_web: boolean;
  created_at: string;
  read?: boolean;
}

export interface SignalFilter {
  id: string;
  user_id: string;
  name: string;
  active: boolean;
  min_liquidity_usd: number | null;
  min_fdv_usd: number | null;
  max_fdv_usd: number | null;
  min_volume_24h: number | null;
  min_holders: number | null;
  max_age_hours: number | null;
  launchpads: string[] | null;
  min_rug_score: number | null;
  require_lp_locked: boolean | null;
  require_mint_revoked: boolean | null;
  min_volume_score: number | null;
  min_social_mindshare: number | null;
  min_social_sentiment: number | null;
  min_galaxy_score: number | null;
  require_roster_wallet: boolean;
  min_roster_wallets: number;
  matches24h: number;
  created_at: string;
}

export interface VolumeSignal {
  name: string;
  value: number;
  threshold: string;
  flag: boolean;
  weight: number;
}

export interface VolumeOutput {
  score: number;
  verdict: "organic" | "mixed" | "likely_paid" | "wash";
  signals: VolumeSignal[];
}

export interface SocialSignals {
  kolMentions: number;
  totalTrackedChannels: number;
  trending: boolean;
}

export type Launchpad =
  | "pumpfun"
  | "letsbonk"
  | "moonshot"
  | "bags"
  | "launchlab"
  | "believe"
  | "heavendex"
  | "raydium"
  | "unknown";

export interface DdCard {
  tokenAddress: string;
  symbol: string | null;
  name: string | null;
  chain: string;
  launchpad: Launchpad;
  graduated: boolean | null;
  marketDataSource: string;
  statusLabel: string;
  market: {
    fdvUsd: number | null;
    liquidityUsd: number | null;
    volume24hUsd: number | null;
    priceUsd: number | null;
    marketCapUsd: number | null;
    pairAddress: string | null;
  };
  safety: {
    mintAuthorityRevoked: boolean;
    freezeAuthorityRevoked: boolean;
    lpLocked: boolean;
    honeypotClean: boolean;
    top10HolderPct: number | null;
    deployerAddress: string | null;
    deployerPriorRugs: number;
    rugScore: number;
  };
  volume: VolumeOutput | null;
  socialSignals: SocialSignals;
  verdictText: string;
  generatedAt: string;
}
