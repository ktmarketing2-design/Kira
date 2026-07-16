export interface BuyBot {
  label: string;
  urlTemplate: string;
  graduatedOnly: boolean; // if true, only show for graduated tokens
}

export const BUY_BOTS: BuyBot[] = [
  { label: "🤖 Trojan", urlTemplate: "https://t.me/solana_trojanbot?start={address}", graduatedOnly: false },
  { label: "🐂 BullX", urlTemplate: "https://t.me/BullxNeoBot?start={address}", graduatedOnly: false },
  { label: "🎯 Maestro", urlTemplate: "https://t.me/MaestroSniper_bot?start={address}", graduatedOnly: false },
  { label: "🐶 BONKbot", urlTemplate: "https://t.me/bonkbot_bot?start={address}", graduatedOnly: false },
  { label: "⚡ Jupiter ↗", urlTemplate: "https://jup.ag/swap/SOL-{address}", graduatedOnly: true },
];

export function getBuyBots(isGraduated: boolean): BuyBot[] {
  return BUY_BOTS.filter((bot) => !bot.graduatedOnly || isGraduated);
}
