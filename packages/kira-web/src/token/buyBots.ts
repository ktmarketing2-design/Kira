export interface BuyBot {
  label: string;
  urlTemplate: string;
  type: "telegram" | "url";
  graduatedOnly: boolean; // if true, only show for graduated tokens
}

export const BUY_BOTS: BuyBot[] = [
  {
    label: "🤖 Trojan",
    urlTemplate: "https://t.me/solana_trojanbot?start=r-luckykhelly-{address}",
    type: "telegram",
    graduatedOnly: false,
  },
  {
    label: "🌸 Bloom",
    urlTemplate: "https://t.me/BloomSolana_bot?start=ref_BX02QG5C1T_ca_{address}",
    type: "telegram",
    graduatedOnly: false,
  },
  {
    label: "🎯 Maestro",
    urlTemplate: "https://t.me/maestro?start={address}-luckykhelly",
    type: "telegram",
    graduatedOnly: false,
  },
  {
    label: "🐶 BONKbot",
    urlTemplate: "https://t.me/bonkbot_bot?start=ref_nuqla_ca_{address}",
    type: "telegram",
    graduatedOnly: false,
  },
  {
    label: "⚡ Jupiter ↗",
    urlTemplate: "https://jup.ag/swap/SOL-{address}",
    type: "url",
    graduatedOnly: true, // only show for graduated tokens on a DEX
  },
];

export function getBuyBots(isGraduated: boolean): BuyBot[] {
  return BUY_BOTS.filter((bot) => !bot.graduatedOnly || isGraduated);
}
