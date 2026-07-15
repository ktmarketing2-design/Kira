import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "./useAuth.js";
import { apiRequest, ApiError } from "../lib/api.js";

export default function LinkPage() {
  const { code } = useParams<{ code: string }>();
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"waiting" | "linking" | "done" | "error">("waiting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !code) return;
    if (!session) {
      setStatus("waiting");
      return;
    }

    setStatus("linking");
    apiRequest<{ linked: boolean }>("POST", "/auth/telegram-link", { code })
      .then(() => {
        setStatus("done");
        setTimeout(() => navigate("/dashboard"), 3000);
      })
      .catch((err) => {
        setStatus("error");
        setError(err instanceof ApiError ? String(err.body ?? err.message) : "Something went wrong.");
      });
  }, [loading, session, code, navigate]);

  return (
    <div className="min-h-screen bg-kira-bg flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-kira-surface border border-kira-border rounded-md p-6 text-center">
        <div className="font-display text-xl tracking-widest text-kira-text mb-4">KIRA</div>

        {status === "waiting" && !loading && (
          <>
            <p className="text-sm text-kira-text">Log in to connect your Telegram account.</p>
            <a href="/login" className="inline-block mt-4 text-kira-accent text-sm hover:underline">
              Go to login →
            </a>
          </>
        )}
        {(loading || status === "linking") && <p className="text-sm text-kira-text-muted">Connecting...</p>}
        {status === "done" && (
          <>
            <p className="text-sm text-kira-green">Telegram connected.</p>
            <p className="text-xs text-kira-text-muted mt-2">
              Alerts will now be delivered to your Telegram. Redirecting...
            </p>
          </>
        )}
        {status === "error" && (
          <>
            <p className="text-sm text-kira-red">Couldn't connect Telegram.</p>
            <p className="text-xs text-kira-text-muted mt-2">{error}</p>
          </>
        )}
      </div>
    </div>
  );
}
