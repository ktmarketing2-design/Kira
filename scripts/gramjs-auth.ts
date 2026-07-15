// One-time GramJS (MTProto) auth script for the Kira KOL-ingestion burner Telegram account.
//
// Run from the monorepo root:
//   npx tsx scripts/gramjs-auth.ts
//
// Prompts interactively for phone number, verification code, and 2FA password (if enabled),
// then prints the resulting session string to the console ONLY. It is never written to a file
// or logged anywhere else. Copy it manually and hand it to Antigravity to set as
// TELEGRAM_MTPROTO_SESSION in the server env, this script does not touch .env itself.
//
// Per AGENTS.md / the Kira ownership boundary: the burner account's session string is a
// full-account credential. Do not run this against a personal Telegram account.

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import input from "input";

process.loadEnvFile(new URL("../.env", import.meta.url));

const apiId = Number(process.env.TELEGRAM_MTPROTO_API_ID);
const apiHash = process.env.TELEGRAM_MTPROTO_API_HASH;

if (!apiId || !apiHash) {
  console.error(
    "TELEGRAM_MTPROTO_API_ID and TELEGRAM_MTPROTO_API_HASH must be set in .env before running this script.",
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
    connectionRetries: 5,
  });

  console.log("Starting Telegram login for the Kira KOL-ingestion burner account.\n");

  await client.start({
    phoneNumber: async () => input.text("Phone number (with country code, e.g. +1...): "),
    phoneCode: async () => input.text("Verification code sent to that phone: "),
    password: async () => input.text("2FA password (press enter if not enabled): "),
    onError: (err) => console.error("Login error:", err.message),
  });

  const sessionString = client.session.save() as unknown as string;

  console.log("\n========================================");
  console.log("SESSION STRING (copy this entire line):");
  console.log(sessionString);
  console.log("========================================\n");
  console.log("Do not commit this anywhere. Hand it to Antigravity to set as");
  console.log("TELEGRAM_MTPROTO_SESSION in the server env.\n");

  await client.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("gramjs-auth failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
