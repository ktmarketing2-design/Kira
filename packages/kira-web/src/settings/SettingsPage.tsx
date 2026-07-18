import { useState } from "react";
import { useAuth } from "../auth/useAuth.js";
import { useAppData } from "../shell/AppDataContext.js";
import { apiRequest } from "../lib/api.js";
import { alertSoundsEnabled, setAlertSoundsEnabled } from "../lib/alertSound.js";

const WINDOW_OPTIONS = [
  { label: "1h", value: 60 },
  { label: "2h", value: 120 },
  { label: "4h", value: 240 },
  { label: "8h", value: 480 },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-tt-bg-raised border border-tt-border rounded-md p-4">
      <h2 className="text-xs uppercase tracking-wide text-tt-fg-dim mb-3">{title}</h2>
      {children}
    </div>
  );
}

export default function SettingsPage() {
  const { session } = useAuth();
  const { me, refreshMe } = useAppData();
  const tier = me?.tier ?? "scout";
  const minThreshold = tier === "scout" ? 3 : 2;

  const [threshold, setThreshold] = useState(me?.settings?.cluster_threshold ?? 3);
  const [windowMinutes, setWindowMinutes] = useState(me?.settings?.window_minutes ?? 240);
  const [minUsd, setMinUsd] = useState(me?.settings?.min_usd_per_buy ?? 100);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [soundsOn, setSoundsOn] = useState(alertSoundsEnabled());
  const [linkCode, setLinkCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [linkCodeLoading, setLinkCodeLoading] = useState(false);

  async function handleGenerateLinkCode() {
    setLinkCodeLoading(true);
    try {
      const res = await apiRequest<{ code: string; expiresAt: string }>("POST", "/auth/telegram-link-code");
      setLinkCode(res);
    } finally {
      setLinkCodeLoading(false);
    }
  }

  async function saveSettings() {
    setSaving(true);
    setSaved(false);
    try {
      await apiRequest("PATCH", "/me/settings", {
        clusterThreshold: threshold,
        windowMinutes,
        minUsdPerBuy: minUsd,
      });
      await refreshMe();
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="font-display text-lg text-tt-fg">Settings</h1>

      <Section title="Account">
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-tt-fg-dim">Email</dt>
            <dd className="text-tt-fg">{session?.user.email ?? "—"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-tt-fg-dim">Tier</dt>
            <dd className="text-tt-fg uppercase">{tier}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-tt-fg-dim">Tier expires</dt>
            <dd className="text-tt-fg">
              {me?.tierExpiresAt ? new Date(me.tierExpiresAt).toLocaleDateString() : "Never"}
            </dd>
          </div>
        </dl>
      </Section>

      <Section title="Telegram">
        {me?.profile?.telegram_user_id ? (
          <p className="text-sm text-tt-green">
            Connected {me.profile.telegram_username ? `as @${me.profile.telegram_username}` : ""}
          </p>
        ) : linkCode ? (
          <div className="space-y-2">
            <p className="text-sm text-tt-fg-dim">
              Send this to{" "}
              <a
                href="https://t.me/KiraByCeronixBot"
                target="_blank"
                rel="noreferrer"
                className="text-tt-brand hover:underline"
              >
                @KiraByCeronixBot
              </a>
              :
            </p>
            <div className="bg-tt-bg-panel border border-tt-border rounded-md px-3 py-2 font-data text-sm text-tt-fg">
              /link {linkCode.code}
            </div>
            <p className="text-xs text-tt-fg-faint">
              Expires {new Date(linkCode.expiresAt).toLocaleTimeString()}.
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm text-tt-fg-dim mb-2">Not connected.</p>
            <button
              onClick={() => void handleGenerateLinkCode()}
              disabled={linkCodeLoading}
              className="text-xs bg-tt-bg-panel border border-tt-border text-tt-fg rounded-md px-3 py-1.5 hover:border-tt-brand disabled:opacity-50"
            >
              {linkCodeLoading ? "Generating..." : "Link Telegram Account"}
            </button>
          </>
        )}
      </Section>

      <Section title="Alert Settings">
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-tt-fg-dim mb-1">Alert Sounds</label>
            <button
              onClick={() => {
                const next = !soundsOn;
                setSoundsOn(next);
                setAlertSoundsEnabled(next);
              }}
              className={`text-xs px-3 py-1.5 rounded-md border ${
                soundsOn ? "border-tt-brand text-tt-brand" : "border-tt-border text-tt-fg-dim"
              }`}
            >
              {soundsOn ? "On" : "Off"}
            </button>
            <p className="text-xs text-tt-fg-faint mt-1">Play a short ping in the browser when a new alert arrives.</p>
          </div>

          <div>
            <label className="block text-xs text-tt-fg-dim mb-1">Cluster threshold</label>
            <div className="flex gap-2">
              {[2, 3].map((t) => (
                <button
                  key={t}
                  disabled={t < minThreshold}
                  onClick={() => setThreshold(t)}
                  className={`text-xs px-3 py-1.5 rounded-md border ${
                    threshold === t
                      ? "border-tt-brand text-tt-brand"
                      : "border-tt-border text-tt-fg-dim"
                  } ${t < minThreshold ? "opacity-40 cursor-not-allowed" : ""}`}
                >
                  {t}+ wallets
                </button>
              ))}
            </div>
            {tier === "scout" && <p className="text-xs text-tt-fg-faint mt-1">Scout tier is locked to 3+.</p>}
          </div>

          <div>
            <label className="block text-xs text-tt-fg-dim mb-1">Window</label>
            <div className="flex gap-2">
              {WINDOW_OPTIONS.map((w) => (
                <button
                  key={w.value}
                  onClick={() => setWindowMinutes(w.value)}
                  className={`text-xs px-3 py-1.5 rounded-md border ${
                    windowMinutes === w.value
                      ? "border-tt-brand text-tt-brand"
                      : "border-tt-border text-tt-fg-dim"
                  }`}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-tt-fg-dim mb-1">Min USD per buy</label>
            <input
              type="number"
              value={minUsd}
              onChange={(e) => setMinUsd(Number(e.target.value))}
              className="w-32 bg-tt-bg-panel border border-tt-border rounded-md px-3 py-1.5 text-sm text-tt-fg focus:outline-none focus:border-tt-brand"
            />
          </div>

          <button
            onClick={() => void saveSettings()}
            disabled={saving}
            className="bg-tt-brand text-tt-bg rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
          {saved && <span className="text-xs text-tt-green ml-3">Saved.</span>}
        </div>
      </Section>

      <Section title="Billing">
        <p className="text-sm text-tt-fg-dim mb-2">Current tier: <span className="text-tt-fg uppercase">{tier}</span></p>
        <a href="/upgrade" className="text-tt-brand text-sm hover:underline">
          Upgrade →
        </a>
      </Section>
    </div>
  );
}
