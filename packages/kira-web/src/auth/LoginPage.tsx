import { useState, type FormEvent } from "react";
import { useAuth } from "./useAuth.js";

export default function LoginPage() {
  const { sendMagicLink, configError } = useAuth();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email) return;
    setStatus("sending");
    setError(null);
    const err = await sendMagicLink(email);
    if (err) {
      setStatus("error");
      setError(err);
      return;
    }
    setStatus("sent");
  }

  return (
    <div className="min-h-screen bg-kira-bg flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="font-display text-2xl tracking-widest text-kira-text">KIRA</div>
          <div className="text-kira-text-muted text-xs mt-1">by Ceronix Labs</div>
        </div>

        <div className="bg-kira-surface border border-kira-border rounded-md p-6">
          {configError && (
            <div className="mb-4 text-xs text-kira-red border border-kira-red/40 rounded p-2">
              {configError}
            </div>
          )}

          {status === "sent" ? (
            <div className="text-center py-4">
              <p className="text-kira-text text-sm">Check your inbox.</p>
              <p className="text-kira-text-muted text-xs mt-2">
                We sent a magic link to <span className="text-kira-text">{email}</span>. Click it to sign in.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <label className="block text-xs text-kira-text-muted uppercase tracking-wide">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full bg-kira-surface-2 border border-kira-border rounded px-3 py-2 text-sm text-kira-text placeholder:text-kira-text-dim focus:outline-none focus:border-kira-accent"
              />
              {status === "error" && error && <p className="text-xs text-kira-red">{error}</p>}
              <button
                type="submit"
                disabled={status === "sending"}
                className="w-full bg-kira-accent text-kira-bg text-sm font-medium rounded px-3 py-2 hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {status === "sending" ? "Sending..." : "Send magic link"}
              </button>
            </form>
          )}
        </div>

        <div className="mt-4 bg-kira-surface border border-kira-border rounded-md p-4">
          <p className="text-xs text-kira-text-muted mb-2">Or connect with Telegram</p>
          <a
            href="https://t.me/KiraByCeronixBot"
            target="_blank"
            rel="noreferrer"
            className="text-kira-accent text-sm font-data hover:underline"
          >
            @KiraByCeronixBot
          </a>
          <p className="text-xs text-kira-text-dim mt-2">
            Message /start to the bot, then use the link it sends you to connect this account.
          </p>
        </div>
      </div>
    </div>
  );
}
