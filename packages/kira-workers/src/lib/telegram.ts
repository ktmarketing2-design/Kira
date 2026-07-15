import { Api } from "grammy";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN must be set in the environment");
}

// Raw API client (no polling loop) for one-off pushes from workers, kira-bot owns the
// long-polling Bot instance for interactive commands.
export const telegramApi = new Api(token);
