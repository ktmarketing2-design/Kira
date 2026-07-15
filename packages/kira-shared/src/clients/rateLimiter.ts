/**
 * In-memory sliding-window rate limiter. One instance per external API client,
 * process-local (fine for a single-process worker/API on the VPS; not shared across processes).
 */
export class RateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private timestamps: number[] = [];
  private queue: Array<() => void> = [];
  private draining = false;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  async acquire(): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      this.drain();
    });
  }

  private drain(): void {
    if (this.draining) return;
    this.draining = true;
    void this.drainLoop();
  }

  private async drainLoop(): Promise<void> {
    while (this.queue.length > 0) {
      const now = Date.now();
      this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);

      if (this.timestamps.length < this.maxRequests) {
        this.timestamps.push(now);
        const next = this.queue.shift();
        next?.();
        continue;
      }

      const oldest = this.timestamps[0];
      const waitMs = Math.max(0, this.windowMs - (now - oldest)) + 5;
      await new Promise((r) => setTimeout(r, waitMs));
    }
    this.draining = false;
  }
}
