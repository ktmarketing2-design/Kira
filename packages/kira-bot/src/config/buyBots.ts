export interface BuyBot {
  label: string;
  urlTemplate: string;
  type: "telegram" | "url";
  graduatedOnly: boolean; // if true, only show for graduated tokens
}

export const BUY_BOTS: BuyBot[] = [
  {
    label: "🤖 Trojan",
    urlTemplate: "https://t.me/solana_trojanbot?start={address}",
    type: "telegram",
    graduatedOnly: false, // works for both pre and post graduation
  },
  {
    label: "🐂 BullX",
    urlTemplate: "https://t.me/BullxNeoBot?start={address}",
    type: "telegram",
    graduatedOnly: false,
  },
  {
    label: "🎯 Maestro",
    urlTemplate: "https://t.me/MaestroSniper_bot?start={address}",
    type: "telegram",
    graduatedOnly: false, // supports 14 chains, Solana + pump.fun included
  },
  {
    label: "🐶 BONKbot",
    urlTemplate: "https://t.me/bonkbot_bot?start={address}",
    type: "telegram",
    graduatedOnly: false, // best for beginners, fast clean UI
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
