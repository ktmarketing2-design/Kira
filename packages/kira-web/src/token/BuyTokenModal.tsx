import { getBuyBots } from "./buyBots.js";

interface BuyTokenModalProps {
  symbol: string;
  tokenAddress: string;
  isGraduated: boolean;
  onClose: () => void;
}

export default function BuyTokenModal({ symbol, tokenAddress, isGraduated, onClose }: BuyTokenModalProps) {
  const bots = getBuyBots(isGraduated);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      onClick={onClose}
    >
      <div
        className="bg-kira-surface border border-kira-border rounded-md p-5 w-full max-w-sm relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 text-kira-text-dim hover:text-kira-text text-lg leading-none"
        >
          ✕
        </button>

        <h2 className="font-display text-lg text-kira-text mb-1">💰 Buy ${symbol}</h2>
        <p className="text-xs text-kira-text-muted mb-4">Choose your preferred trading bot:</p>

        <div className="grid grid-cols-2 gap-2">
          {bots.map((bot) => (
            <button
              key={bot.label}
              onClick={() => {
                window.open(bot.urlTemplate.replace("{address}", tokenAddress), "_blank", "noopener,noreferrer");
              }}
              className="bg-kira-surface-2 border border-kira-border rounded px-3 py-2 text-sm text-kira-text hover:border-kira-accent"
            >
              {bot.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
