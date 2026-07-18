const STORAGE_KEY = "alertSounds";

export function alertSoundsEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEY) === "true";
}

export function setAlertSoundsEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
}

/** Subtle 880Hz ping, ~0.3s decay. Web Audio API, no audio file asset needed. */
export function playAlertSound(): void {
  if (!alertSoundsEnabled()) return;
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch {
    // AudioContext can throw if the browser blocks autoplay before any user gesture -- non-fatal,
    // the alert itself still landed, just silently.
  }
}
