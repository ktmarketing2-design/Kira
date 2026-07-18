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
    <div className="flex items-center gap-3 flex-wrap py-2 mb-2 border-b border-kira-border text-sm">
      {meta.logo && <img src={meta.logo} alt="" className="w-6 h-6 rounded-full" />}
      <span className="font-bold text-kira-text">${meta.symbol ?? "?"}</span>
      {meta.name && <span className="text-kira-text-muted">{meta.name}</span>}
      {meta.launchpad && (
        <span className="bg-kira-surface-2 text-kira-accent text-xs px-2 py-0.5 rounded">{meta.launchpad}</span>
      )}
      <span className="text-kira-text-dim font-data text-xs flex items-center gap-1">
        {truncate(address)}
        <button
          onClick={() => navigator.clipboard.writeText(address)}
          className="text-kira-accent hover:opacity-80"
          aria-label="Copy address"
        >
          ⎘
        </button>
      </span>
      <div className="flex items-center gap-2 text-kira-text-muted text-sm">
        {meta.social.twitter && (
          <a
            href={`https://twitter.com/${meta.social.twitter}`}
            target="_blank"
            rel="noreferrer"
            className="hover:text-kira-text"
          >
            𝕏
          </a>
        )}
        {meta.social.telegram && (
          <a href={meta.social.telegram} target="_blank" rel="noreferrer" className="hover:text-kira-text">
            ✈️
          </a>
        )}
        {meta.social.website && (
          <a href={meta.social.website} target="_blank" rel="noreferrer" className="hover:text-kira-text">
            🌐
          </a>
        )}
      </div>
      {meta.createdAt && (
        <span className="text-kira-text-dim text-xs">
          Created {new Date(meta.createdAt * 1000).toLocaleDateString()}
        </span>
      )}
    </div>
  );
}
