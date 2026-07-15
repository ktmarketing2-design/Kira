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
function formatSocialSignals(signals: SocialSignals): string {
  if (signals.kolMentions === 0 && !signals.trending) {
    return escapeMarkdownV2("🌐 Social Signals: No activity detected in tracked channels");
  }

  return [
    "🌐 *Social Signals \\(24h\\)*",
    escapeMarkdownV2(`📡 KOL mentions: ${signals.kolMentions} of ${signals.totalTrackedChannels} tracked channels`),
    escapeMarkdownV2(`🔥 DexScreener trending: ${signals.trending ? "Yes" : "No"}`),
  ].join("\n");
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

  if (card.market.fdvUsd != null) lines.push(escapeMarkdownV2(`FDV: $${Math.round(card.market.fdvUsd).toLocaleString("en-US")}`));
  if (card.market.liquidityUsd != null) lines.push(escapeMarkdownV2(`Liquidity: $${Math.round(card.market.liquidityUsd).toLocaleString("en-US")}`));
  if (card.market.volume24hUsd != null) lines.push(escapeMarkdownV2(`24h Volume: $${Math.round(card.market.volume24hUsd).toLocaleString("en-US")}`));

  lines.push("", formatSocialSignals(card.socialSignals), "", escapeMarkdownV2(card.verdictText));

  return lines.join("\n");
}
