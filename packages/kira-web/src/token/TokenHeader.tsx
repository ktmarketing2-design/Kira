export interface TokenFullMeta {
  symbol: string | null;
  name: string | null;
  logo: string | null;
  launchpad: string | null;
  createdAt: number | null;
  social: { twitter: string | null; telegram: string | null; website: string | null };
}

function truncate(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export default function TokenHeader({ address, meta }: { address: string; meta: TokenFullMeta }) {
  return (
    <div className="flex items-center gap-3 flex-wrap py-2.5 mb-2 border-b border-tt-border text-sm">
      {meta.logo && <img src={meta.logo} alt="" className="w-6 h-6 rounded-full" />}
      <span className="font-display text-sm text-tt-green">${meta.symbol ?? "?"}</span>
      {meta.name && <span className="text-tt-fg-dim text-xs">{meta.name}</span>}
      {meta.launchpad && (
        <span className="bg-tt-bg-raised border border-tt-border text-tt-brand text-[10px] px-2 py-0.5 rounded-md">
          {meta.launchpad}
        </span>
      )}
      <span className="text-tt-fg-faint font-body text-[10px] flex items-center gap-1">
        {truncate(address)}
        <button
          onClick={() => navigator.clipboard.writeText(address)}
          className="text-tt-green hover:opacity-80"
          aria-label="Copy address"
        >
          ⎘
        </button>
      </span>
      <div className="flex items-center gap-2 text-tt-fg-dim text-sm">
        {meta.social.twitter && (
          <a
            href={`https://twitter.com/${meta.social.twitter}`}
            target="_blank"
            rel="noreferrer"
            className="hover:text-tt-fg"
          >
            𝕏
          </a>
        )}
        {meta.social.telegram && (
          <a href={meta.social.telegram} target="_blank" rel="noreferrer" className="hover:text-tt-fg">
            ✈️
          </a>
        )}
        {meta.social.website && (
          <a href={meta.social.website} target="_blank" rel="noreferrer" className="hover:text-tt-fg">
            🌐
          </a>
        )}
      </div>
      {meta.createdAt && (
        <span className="text-tt-fg-faint text-[10px]">
          Created {new Date(meta.createdAt * 1000).toLocaleDateString()}
        </span>
      )}
    </div>
  );
}
