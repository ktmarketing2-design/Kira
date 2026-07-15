import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4020";

interface SharedDrawingResponse {
  tokenAddress: string;
  drawings: unknown[];
  updatedAt: string;
}

/**
 * Public, unauthenticated view of a shared drawing set. Deliberately does not reuse the
 * authenticated ChartStudio component (that one always calls kira-api with a Supabase JWT), a
 * logged-out visitor has none. Renders a lightweight read-only summary rather than the full
 * interactive chart, keeping this page dependency-light for a link that may get shared widely.
 */
export default function ChartSharePage() {
  const { address, drawingId } = useParams<{ address: string; drawingId: string }>();
  const [data, setData] = useState<SharedDrawingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!drawingId) return;
    fetch(`${API_URL}/chart-drawings/${drawingId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("not found");
        setData(await res.json());
      })
      .catch(() => setError("This shared chart could not be found."));
  }, [drawingId]);

  return (
    <div className="min-h-screen bg-kira-bg flex items-center justify-center px-4">
      <div className="w-full max-w-lg bg-kira-surface border border-kira-border rounded-md p-6">
        <div className="font-display text-lg text-kira-text mb-1">KIRA Chart Studio</div>
        <p className="font-data text-xs text-kira-text-muted mb-4">{address}</p>

        {error && <p className="text-kira-red text-sm">{error}</p>}
        {!data && !error && <p className="text-kira-text-muted text-sm">Loading...</p>}
        {data && (
          <>
            <p className="text-kira-text text-sm mb-2">
              {data.drawings.length} drawing{data.drawings.length === 1 ? "" : "s"} shared
            </p>
            <p className="text-kira-text-dim text-xs">
              Last updated {new Date(data.updatedAt).toLocaleString()}
            </p>
            <a
              href={`/token/${address}`}
              className="inline-block mt-4 text-kira-accent text-sm hover:underline"
            >
              Open full interactive chart on Kira →
            </a>
          </>
        )}
      </div>
    </div>
  );
}
