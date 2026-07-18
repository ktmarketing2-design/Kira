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
    <div className="bg-kira-surface border border-kira-border rounded-md p-4">
      <h2 className="text-xs uppercase tracking-wide text-kira-text-muted mb-3">{title}</h2>
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
      <h1 className="font-display text-lg text-kira-text">Settings</h1>

      <Section title="Account">
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-kira-text-muted">Email</dt>
            <dd className="text-kira-text">{session?.user.email ?? "—"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-kira-text-muted">Tier</dt>
            <dd className="text-kira-text uppercase">{tier}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-kira-text-muted">Tier expires</dt>
            <dd className="text-kira-text">
              {me?.tierExpiresAt ? new Date(me.tierExpiresAt).toLocaleDateString() : "Never"}
            </dd>
          </div>
        </dl>
      </Section>

      <Section title="Telegram">
        {me?.profile?.telegram_user_id ? (
          <p className="text-sm text-kira-green">
            Connected {me.profile.telegram_username ? `as @${me.profile.telegram_username}` : ""}
          </p>
        ) : (
          <>
            <p className="text-sm text-kira-text-muted mb-2">Not connected.</p>
            <a
              href="https://t.me/KiraByCeronixBot"
              target="_blank"
              rel="noreferrer"
              className="text-kira-accent text-sm hover:underline"
            >
              Message @KiraByCeronixBot to connect
            </a>
          </>
        )}
      </Section>

      <Section title="Alert Settings">
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-kira-text-muted mb-1">Alert Sounds</label>
            <button
              onClick={() => {
                const next = !soundsOn;
                setSoundsOn(next);
                setAlertSoundsEnabled(next);
              }}
              className={`text-xs px-3 py-1.5 rounded border ${
                soundsOn ? "border-kira-accent text-kira-accent" : "border-kira-border text-kira-text-muted"
              }`}
            >
              {soundsOn ? "On" : "Off"}
            </button>
            <p className="text-xs text-kira-text-dim mt-1">Play a short ping in the browser when a new alert arrives.</p>
          </div>

          <div>
            <label className="block text-xs text-kira-text-muted mb-1">Cluster threshold</label>
            <div className="flex gap-2">
              {[2, 3].map((t) => (
                <button
                  key={t}
                  disabled={t < minThreshold}
                  onClick={() => setThreshold(t)}
                  className={`text-xs px-3 py-1.5 rounded border ${
                    threshold === t
                      ? "border-kira-accent text-kira-accent"
                      : "border-kira-border text-kira-text-muted"
                  } ${t < minThreshold ? "opacity-40 cursor-not-allowed" : ""}`}
                >
                  {t}+ wallets
                </button>
              ))}
            </div>
            {tier === "scout" && <p className="text-xs text-kira-text-dim mt-1">Scout tier is locked to 3+.</p>}
          </div>

          <div>
            <label className="block text-xs text-kira-text-muted mb-1">Window</label>
            <div className="flex gap-2">
              {WINDOW_OPTIONS.map((w) => (
                <button
                  key={w.value}
                  onClick={() => setWindowMinutes(w.value)}
                  className={`text-xs px-3 py-1.5 rounded border ${
                    windowMinutes === w.value
                      ? "border-kira-accent text-kira-accent"
                      : "border-kira-border text-kira-text-muted"
                  }`}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-kira-text-muted mb-1">Min USD per buy</label>
            <input
              type="number"
              value={minUsd}
              onChange={(e) => setMinUsd(Number(e.target.value))}
              className="w-32 bg-kira-surface-2 border border-kira-border rounded px-3 py-1.5 text-sm text-kira-text focus:outline-none focus:border-kira-accent"
            />
          </div>

          <button
            onClick={() => void saveSettings()}
            disabled={saving}
            className="bg-kira-accent text-kira-bg rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
          {saved && <span className="text-xs text-kira-green ml-3">Saved.</span>}
        </div>
      </Section>

      <Section title="Billing">
        <p className="text-sm text-kira-text-muted mb-2">Current tier: <span className="text-kira-text uppercase">{tier}</span></p>
        <a href="/upgrade" className="text-kira-accent text-sm hover:underline">
          Upgrade →
        </a>
      </Section>
    </div>
  );
}
