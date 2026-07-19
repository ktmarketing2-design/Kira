import { X, Wallet } from "lucide-react";
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
        className="bg-tt-bg-raised border border-tt-border rounded-md p-5 w-full max-w-sm relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 text-tt-fg-faint hover:text-tt-fg leading-none"
        >
          <X size={18} />
        </button>

        <h2 className="font-display text-lg text-tt-fg mb-1 flex items-center gap-1.5">
          <Wallet size={16} /> Buy ${symbol}
        </h2>
        <p className="text-xs text-tt-fg-dim mb-4">Choose your preferred trading bot:</p>

        <div className="grid grid-cols-2 gap-2">
          {bots.map((bot) => (
            <button
              key={bot.label}
              onClick={() => {
                window.open(bot.urlTemplate.replace("{address}", tokenAddress), "_blank", "noopener,noreferrer");
              }}
              className="bg-tt-bg-panel border border-tt-border rounded-md px-3 py-2 text-sm text-tt-fg hover:border-tt-brand"
            >
              {bot.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
