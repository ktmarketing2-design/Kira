import { useState } from "react";
import type { SignalFilter } from "../lib/types.js";

const LAUNCHPAD_OPTIONS = ["pumpfun", "letsbonk", "bags", "launchlab", "raydium", "moonshot"];

export interface FilterFormValues {
  name: string;
  minLiquidityUsd: number | null;
  minFdvUsd: number | null;
  maxFdvUsd: number | null;
  minVolume24h: number | null;
  minHolders: number | null;
  maxAgeHours: number | null;
  launchpads: string[];
  minRugScore: number | null;
  requireLpLocked: boolean;
  requireMintRevoked: boolean;
  minVolumeScore: number | null;
  minSocialMindshare: number | null;
  minSocialSentiment: number | null;
  minGalaxyScore: number | null;
  requireRosterWallet: boolean;
  minRosterWallets: number;
}

function fromFilter(f?: SignalFilter): FilterFormValues {
  return {
    name: f?.name ?? "",
    minLiquidityUsd: f?.min_liquidity_usd ?? null,
    minFdvUsd: f?.min_fdv_usd ?? null,
    maxFdvUsd: f?.max_fdv_usd ?? null,
    minVolume24h: f?.min_volume_24h ?? null,
    minHolders: f?.min_holders ?? null,
    maxAgeHours: f?.max_age_hours ?? null,
    launchpads: f?.launchpads ?? [],
    minRugScore: f?.min_rug_score ?? null,
    requireLpLocked: f?.require_lp_locked ?? false,
    requireMintRevoked: f?.require_mint_revoked ?? false,
    minVolumeScore: f?.min_volume_score ?? null,
    minSocialMindshare: f?.min_social_mindshare ?? null,
    minSocialSentiment: f?.min_social_sentiment ?? null,
    minGalaxyScore: f?.min_galaxy_score ?? null,
    requireRosterWallet: f?.require_roster_wallet ?? false,
    minRosterWallets: f?.min_roster_wallets ?? 1,
  };
}

function NumberCriterion({
  label,
  value,
  onChange,
  unit,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  unit?: string;
}) {
  const enabled = value != null;
  return (
    <div className="flex items-center gap-2 py-1.5">
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => onChange(e.target.checked ? 0 : null)}
        className="accent-kira-accent"
      />
      <span className="text-xs text-kira-text-muted w-40 shrink-0">{label}</span>
      <input
        type="number"
        disabled={!enabled}
        value={value ?? ""}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-32 bg-kira-surface-2 border border-kira-border rounded px-2 py-1 text-xs text-kira-text disabled:opacity-40"
      />
      {unit && <span className="text-xs text-kira-text-dim">{unit}</span>}
    </div>
  );
}

function BoolCriterion({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 py-1.5 text-xs text-kira-text-muted">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="accent-kira-accent" />
      {label}
    </label>
  );
}

function previewText(v: FilterFormValues): string {
  const bits: string[] = [];
  if (v.minLiquidityUsd != null) bits.push(`liquidity ≥ $${v.minLiquidityUsd.toLocaleString("en-US")}`);
  if (v.minFdvUsd != null) bits.push(`FDV ≥ $${v.minFdvUsd.toLocaleString("en-US")}`);
  if (v.maxFdvUsd != null) bits.push(`FDV ≤ $${v.maxFdvUsd.toLocaleString("en-US")}`);
  if (v.minVolume24h != null) bits.push(`24h volume ≥ $${v.minVolume24h.toLocaleString("en-US")}`);
  if (v.minHolders != null) bits.push(`holders ≥ ${v.minHolders}`);
  if (v.maxAgeHours != null) bits.push(`under ${v.maxAgeHours}h old`);
  if (v.launchpads.length) bits.push(`on ${v.launchpads.join("/")}`);
  if (v.minRugScore != null) bits.push(`rug score ≥ ${v.minRugScore}`);
  if (v.requireLpLocked) bits.push("LP locked");
  if (v.requireMintRevoked) bits.push("mint revoked");
  if (v.minVolumeScore != null) bits.push(`volume score ≥ ${v.minVolumeScore}`);
  if (v.minSocialMindshare != null) bits.push(`mindshare ≥ ${v.minSocialMindshare}`);
  if (v.minSocialSentiment != null) bits.push(`sentiment ≥ ${v.minSocialSentiment}`);
  if (v.minGalaxyScore != null) bits.push(`galaxy score ≥ ${v.minGalaxyScore}`);
  if (v.requireRosterWallet) bits.push(`${v.minRosterWallets}+ roster wallet(s) buying`);
  return bits.length ? bits.join(", ") : "anything (no criteria set)";
}

export default function FilterForm({
  initial,
  onCancel,
  onSubmit,
  submitting,
}: {
  initial?: SignalFilter;
  onCancel: () => void;
  onSubmit: (values: FilterFormValues) => void;
  submitting: boolean;
}) {
  const [values, setValues] = useState<FilterFormValues>(fromFilter(initial));

  function set<K extends keyof FilterFormValues>(key: K, value: FilterFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function toggleLaunchpad(lp: string) {
    setValues((prev) => ({
      ...prev,
      launchpads: prev.launchpads.includes(lp) ? prev.launchpads.filter((x) => x !== lp) : [...prev.launchpads, lp],
    }));
  }

  return (
    <div className="bg-kira-surface border border-kira-border rounded-md p-4 mb-6">
      <div className="mb-3">
        <label className="block text-xs text-kira-text-muted mb-1">Filter name</label>
        <input
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="e.g. Safe Pump.fun gems"
          className="w-full max-w-sm bg-kira-surface-2 border border-kira-border rounded px-3 py-2 text-sm text-kira-text placeholder:text-kira-text-dim focus:outline-none focus:border-kira-accent"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
        <div>
          <div className="text-xs uppercase tracking-wide text-kira-text-dim mt-2 mb-1">On-chain</div>
          <NumberCriterion label="Min liquidity" value={values.minLiquidityUsd} onChange={(v) => set("minLiquidityUsd", v)} unit="USD" />
          <NumberCriterion label="Min FDV" value={values.minFdvUsd} onChange={(v) => set("minFdvUsd", v)} unit="USD" />
          <NumberCriterion label="Max FDV" value={values.maxFdvUsd} onChange={(v) => set("maxFdvUsd", v)} unit="USD" />
          <NumberCriterion label="Min 24h volume" value={values.minVolume24h} onChange={(v) => set("minVolume24h", v)} unit="USD" />
          <NumberCriterion label="Min holders" value={values.minHolders} onChange={(v) => set("minHolders", v)} />
          <NumberCriterion label="Max age" value={values.maxAgeHours} onChange={(v) => set("maxAgeHours", v)} unit="hours" />
          <NumberCriterion label="Min rug score" value={values.minRugScore} onChange={(v) => set("minRugScore", v)} unit="/100" />
          <BoolCriterion label="Require LP locked" value={values.requireLpLocked} onChange={(v) => set("requireLpLocked", v)} />
          <BoolCriterion label="Require mint revoked" value={values.requireMintRevoked} onChange={(v) => set("requireMintRevoked", v)} />
        </div>

        <div>
          <div className="text-xs uppercase tracking-wide text-kira-text-dim mt-2 mb-1">Volume & social</div>
          <NumberCriterion label="Min volume score" value={values.minVolumeScore} onChange={(v) => set("minVolumeScore", v)} unit="/100" />
          <NumberCriterion label="Min mindshare" value={values.minSocialMindshare} onChange={(v) => set("minSocialMindshare", v)} />
          <NumberCriterion label="Min sentiment" value={values.minSocialSentiment} onChange={(v) => set("minSocialSentiment", v)} unit="/10" />
          <NumberCriterion label="Min galaxy score" value={values.minGalaxyScore} onChange={(v) => set("minGalaxyScore", v)} unit="/100" />

          <div className="text-xs uppercase tracking-wide text-kira-text-dim mt-4 mb-1">Roster overlay</div>
          <BoolCriterion label="Require a roster wallet buying" value={values.requireRosterWallet} onChange={(v) => set("requireRosterWallet", v)} />
          {values.requireRosterWallet && (
            <NumberCriterion label="Min roster wallets" value={values.minRosterWallets} onChange={(v) => set("minRosterWallets", v ?? 1)} />
          )}

          <div className="text-xs uppercase tracking-wide text-kira-text-dim mt-4 mb-1">Launchpads</div>
          <div className="flex flex-wrap gap-2">
            {LAUNCHPAD_OPTIONS.map((lp) => (
              <button
                key={lp}
                type="button"
                onClick={() => toggleLaunchpad(lp)}
                className={`text-xs px-2 py-1 rounded border ${
                  values.launchpads.includes(lp) ? "border-kira-accent text-kira-accent" : "border-kira-border text-kira-text-muted"
                }`}
              >
                {lp}
              </button>
            ))}
          </div>
          <p className="text-xs text-kira-text-dim mt-1">None selected = any launchpad.</p>
        </div>
      </div>

      <div className="mt-4 p-3 bg-kira-surface-2 border border-kira-border rounded text-xs text-kira-text-muted">
        This filter would match tokens that are... <span className="text-kira-text">{previewText(values)}</span>
      </div>

      <div className="flex gap-3 mt-4">
        <button
          onClick={() => onSubmit(values)}
          disabled={submitting || !values.name.trim()}
          className="bg-kira-accent text-kira-bg rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {submitting ? "Saving..." : initial ? "Save Changes" : "Create Filter"}
        </button>
        <button onClick={onCancel} className="text-sm text-kira-text-muted hover:text-kira-text">
          Cancel
        </button>
      </div>
    </div>
  );
}
