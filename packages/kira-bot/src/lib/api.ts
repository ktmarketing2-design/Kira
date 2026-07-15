const BASE_URL = "http://localhost:4020";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error("TELEGRAM_BOT_TOKEN must be set in the environment");
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`kira-api request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/**
 * Internal HTTP client to kira-api over localhost. Authenticates as a specific Telegram user
 * via the shared bot-token header (see kira-api's middleware/auth.ts), not a Supabase JWT.
 */
export async function apiRequest<T>(
  telegramUserId: number,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-kira-bot-token": BOT_TOKEN as string,
      "x-telegram-user-id": String(telegramUserId),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const json = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new ApiError(res.status, json);
  }
  return json as T;
}

/** Bootstrap call with no linked user yet, uses the same bot-token header but no telegram-user lookup. */
export async function telegramStart(
  telegramUserId: number,
  telegramUsername?: string,
): Promise<{ linked: boolean; code?: string; tier?: string; walletCount?: number }> {
  const res = await fetch(`${BASE_URL}/telegram/start`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-kira-bot-token": BOT_TOKEN as string,
    },
    body: JSON.stringify({ telegramUserId, telegramUsername }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new ApiError(res.status, json);
  }
  return json;
}
