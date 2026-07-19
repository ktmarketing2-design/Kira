const MARKDOWN_V2_SPECIAL = /[_*[\]()~`>#+\-=|{}.!]/g;

export function escapeMarkdownV2(text: string): string {
  return text.replace(MARKDOWN_V2_SPECIAL, (char) => `\\${char}`);
}

export function truncateAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

interface SocialSignals {
  kolMentions: number;
  totalTrackedChannels: number;
  trending: boolean;
  xMentions: { count: number; isFloor: boolean } | null;
}

interface DeepIntel {
  smartDegenCount: number | null;
  smartDegenCountCapped: boolean;
  renownedWallets: number | null;
  renownedWalletsCapped: boolean;
  sniperCount: number | null;
  sniperCountCapped: boolean;
  ratTraderSamplePct: number | null;
  bundlerSamplePct: number | null;
  freshWalletSamplePct: number | null;
  devHoldingPct: number | null;
}

interface DdCardLike {
  tokenAddress: string;
  symbol: string | null;
  statusLabel?: string;
  market: { priceUsd: number | null; fdvUsd: number | null; liquidityUsd: number | null; volume24hUsd: number | null };
  safety: {
    mintAuthorityRevoked: boolean;
    freezeAuthorityRevoked: boolean;
    lpLocked: boolean;
    honeypotClean: boolean;
    rugScore: number;
  };
  volume: { score: number; verdict: string } | null;
  socialSignals: SocialSignals;
  deepIntel?: DeepIntel | null;
  verdictText: string;
}

function statusMark(ok: boolean): string {
  return ok ? "✅" : "⚠️";
}

/**
 * Built from Kira's own KOL call log plus one free DexScreener endpoint, replaces the LunarCrush
 * panel, which requires a subscription tier this account does not have and would otherwise show
 * "no data" on every single card. LunarCrush data still flows through the pipeline and schema
 * (kira-workers/ddWorker.ts's `social` field) for when that subscription is active, it's just not
 * what gets displayed here.
 */
function formatXMentions(x: { count: number; isFloor: boolean } | null): string {
  // isFloor means the search API returned a full page (more exist beyond it) -- twitterapi.io has
  // no total-count endpoint on this plan (verified live, 404), so an exact number here past that
  // point would be fabricated precision. "20+" is the honest ceiling of what the API tells us.
  if (!x) return "—";
  return x.isFloor ? `${x.count}+` : `${x.count}`;
}

function formatSocialSignals(signals: SocialSignals): string {
  if (signals.kolMentions === 0 && !signals.trending && !signals.xMentions?.count) {
    return escapeMarkdownV2("🌐 Social Signals: No activity detected in tracked channels");
  }

  return [
    "🌐 *Social Signals \\(24h\\)*",
    escapeMarkdownV2(`📡 KOL mentions: ${signals.kolMentions} of ${signals.totalTrackedChannels} tracked channels`),
    escapeMarkdownV2(`X mentions (24h): ${formatXMentions(signals.xMentions)}`),
    escapeMarkdownV2(`🔥 DexScreener trending: ${signals.trending ? "Yes" : "No"}`),
  ].join("\n");
}

/** GMGN-derived Deep Intel section (Sprint 7 Part 1). Counts that hit the 100-holder sample cap
 * are shown as "100+" rather than a bare 100, since GMGN's holders endpoint has no total-count
 * field beyond the returned (capped) list -- a token with more than 100 matching holders looks
 * identical to one with exactly 100 otherwise. The rat_trader/bundler/fresh_wallet percentages
 * are share of the (also capped-at-100) sampled holder list, not share of volume or of the
 * token's true total holder count -- GMGN's holders endpoint has no aggregate volume-share field
 * for a tag subset, so this is the most honest thing to compute from what's actually available. */
function formatCount(n: number | null, capped: boolean): string {
  if (n == null) return "—";
  return capped ? `${n}+` : String(n);
}

function formatDeepIntel(intel: DeepIntel): string {
  const smartDegenOk = (intel.smartDegenCount ?? 0) > 3;
  const renownedOk = (intel.renownedWallets ?? 0) > 2;
  const ratTraderBad = (intel.ratTraderSamplePct ?? 0) > 30;
  const bundlerBad = (intel.bundlerSamplePct ?? 0) > 20;

  const lines = ["🔬 *Deep Intel*"];
  lines.push(
    escapeMarkdownV2(
      `${smartDegenOk ? "🟢" : "👥"} Smart Money: ${formatCount(intel.smartDegenCount, intel.smartDegenCountCapped)} wallets in`,
    ),
  );
  lines.push(
    escapeMarkdownV2(
      `${renownedOk ? "🟢" : "🎤"} KOL holders: ${formatCount(intel.renownedWallets, intel.renownedWalletsCapped)}`,
    ),
  );
  if (intel.ratTraderSamplePct != null) {
    lines.push(
      escapeMarkdownV2(
        `${ratTraderBad ? "🔴" : "🐀"} Rat traders: ${intel.ratTraderSamplePct.toFixed(0)}% of sampled holders`,
      ),
    );
  }
  if (intel.bundlerSamplePct != null) {
    lines.push(
      escapeMarkdownV2(
        `${bundlerBad ? "🔴" : "🤖"} Bundler bots: ${intel.bundlerSamplePct.toFixed(0)}% of sampled holders`,
      ),
    );
  }
  lines.push(escapeMarkdownV2(`🎯 Snipers at launch: ${formatCount(intel.sniperCount, intel.sniperCountCapped)}`));
  if (intel.devHoldingPct != null) {
    lines.push(escapeMarkdownV2(`👨‍💻 Dev holding: ${intel.devHoldingPct.toFixed(1)}%`));
  }
  if (intel.freshWalletSamplePct != null) {
    lines.push(escapeMarkdownV2(`🆕 Fresh wallets: ${intel.freshWalletSamplePct.toFixed(0)}% of sampled holders`));
  }

  return lines.join("\n");
}

export function formatDdCard(card: DdCardLike): string {
  const symbol = card.symbol ?? "Token";
  const lines = [
    `📋 *Deep Dive: ${escapeMarkdownV2(symbol)}*`,
    `\`${escapeMarkdownV2(truncateAddress(card.tokenAddress))}\``,
  ];

  if (card.statusLabel) {
    lines.push("", escapeMarkdownV2(card.statusLabel));
  }

  lines.push(
    "",
    `🛡 *Rug Score: ${card.safety.rugScore}/100*`,
    `${statusMark(card.safety.mintAuthorityRevoked)} Mint authority revoked`,
    `${statusMark(card.safety.freezeAuthorityRevoked)} Freeze authority revoked`,
    `${statusMark(card.safety.lpLocked)} LP locked`,
    `${statusMark(card.safety.honeypotClean)} Not a honeypot`,
    "",
  );

  if (card.volume) {
    lines.push(`📊 *Volume Score: ${card.volume.score}/100 \\(${escapeMarkdownV2(card.volume.verdict)}\\)*`, "");
  }

  if (card.deepIntel) {
    lines.push(formatDeepIntel(card.deepIntel), "");
  }

  if (card.market.fdvUsd != null) lines.push(escapeMarkdownV2(`FDV: $${Math.round(card.market.fdvUsd).toLocaleString("en-US")}`));
  if (card.market.liquidityUsd != null) lines.push(escapeMarkdownV2(`Liquidity: $${Math.round(card.market.liquidityUsd).toLocaleString("en-US")}`));
  if (card.market.volume24hUsd != null) lines.push(escapeMarkdownV2(`24h Volume: $${Math.round(card.market.volume24hUsd).toLocaleString("en-US")}`));

  lines.push("", formatSocialSignals(card.socialSignals), "", escapeMarkdownV2(card.verdictText));

  return lines.join("\n");
}
