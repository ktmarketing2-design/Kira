export class KiraClientError extends Error {
  readonly source: string;
  readonly status?: number;
  readonly cause?: unknown;

  constructor(source: string, message: string, options?: { status?: number; cause?: unknown }) {
    super(`[${source}] ${message}`);
    this.name = "KiraClientError";
    this.source = source;
    this.status = options?.status;
    this.cause = options?.cause;
  }
}

export function logClientFailure(source: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[kira-shared:${source}] request failed: ${message}`);
}
