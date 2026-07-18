import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "./useAuth.js";

declare global {
  interface Window {
    onKiraTelegramAuth?: (user: Record<string, unknown>) => void;
  }
}

const TELEGRAM_BOT_USERNAME = "KiraByCeronixBot";

/**
 * Injects Telegram's own widget script (https://core.telegram.org/widgets/login), which renders
 * its own "Log in with Telegram" button and calls window.onKiraTelegramAuth with the signed auth
 * payload once the user approves. Verification of that payload happens server-side (see
 * POST /auth/telegram-login) -- the widget script itself is just Telegram's UI, not part of the
 * trust boundary.
 */
function TelegramLoginWidget({ onAuth }: { onAuth: (data: Record<string, unknown>) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.onKiraTelegramAuth = onAuth;

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", TELEGRAM_BOT_USERNAME);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "7");
    script.setAttribute("data-onauth", "onKiraTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");

    containerRef.current?.appendChild(script);

    return () => {
      delete window.onKiraTelegramAuth;
      if (containerRef.current) containerRef.current.innerHTML = "";
    };
  }, [onAuth]);

  return <div ref={containerRef} className="flex justify-center" />;
}

export default function LoginPage() {
  const { sendMagicLink, signInWithTelegram, configError } = useAuth();
  const [method, setMethod] = useState<"email" | "telegram">("email");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [telegramLoading, setTelegramLoading] = useState(false);

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

  async function handleTelegramAuth(data: Record<string, unknown>) {
    setTelegramLoading(true);
    setError(null);
    const err = await signInWithTelegram(data);
    setTelegramLoading(false);
    if (err) setError(err);
    // On success, the Supabase auth state listener picks up the new session and the router's
    // Protected wrapper takes over -- no explicit navigate() needed here.
  }

  return (
    <div className="min-h-screen bg-tt-bg flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <img
            src="/kira-logo.jpeg"
            alt="Kira by Ceronix Labs"
            className="w-[150px] h-[44px] object-cover object-center rounded-[3px]"
          />
        </div>

        <div className="bg-tt-bg-raised border border-tt-border rounded-md p-6">
          <div className="flex gap-2 mb-5">
            <button
              onClick={() => setMethod("email")}
              className={`flex-1 text-xs uppercase tracking-wide py-2 rounded-md border ${
                method === "email" ? "border-tt-brand text-tt-brand" : "border-tt-border text-tt-fg-dim"
              }`}
            >
              Email
            </button>
            <button
              onClick={() => setMethod("telegram")}
              className={`flex-1 text-xs uppercase tracking-wide py-2 rounded-md border ${
                method === "telegram" ? "border-tt-brand text-tt-brand" : "border-tt-border text-tt-fg-dim"
              }`}
            >
              Telegram
            </button>
          </div>

          {configError && (
            <div className="mb-4 text-xs text-tt-red border border-tt-red/40 rounded-md p-2">{configError}</div>
          )}

          {method === "email" ? (
            status === "sent" ? (
              <div className="text-center py-4">
                <p className="text-tt-fg text-sm">Check your inbox.</p>
                <p className="text-tt-fg-dim text-xs mt-2">
                  We sent a magic link to <span className="text-tt-fg">{email}</span>. Click it to sign in.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3">
                <label className="block text-xs text-tt-fg-dim uppercase tracking-wide">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full bg-tt-bg-panel border border-tt-border rounded-md px-3 py-2 text-sm text-tt-fg placeholder:text-tt-fg-faint focus:outline-none focus:border-tt-brand"
                />
                {status === "error" && error && <p className="text-xs text-tt-red">{error}</p>}
                <button
                  type="submit"
                  disabled={status === "sending"}
                  className="w-full bg-tt-brand text-tt-bg text-sm font-medium rounded-md px-3 py-2 hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {status === "sending" ? "Sending..." : "Send magic link"}
                </button>
              </form>
            )
          ) : (
            <div className="py-2">
              <p className="text-xs text-tt-fg-dim text-center mb-4">
                Sign in instantly with your Telegram account.
              </p>
              {telegramLoading ? (
                <p className="text-xs text-tt-fg-dim text-center py-3">Signing in...</p>
              ) : (
                <TelegramLoginWidget onAuth={(data) => void handleTelegramAuth(data)} />
              )}
              {error && <p className="text-xs text-tt-red text-center mt-3">{error}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
