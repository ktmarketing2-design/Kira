// =============================================================================
// kira-api (Express, port 4020)
// =============================================================================
// Thin and synchronous: auth, tier gating, CRUD, and enqueueing work for kira-workers.
// Owned by Claude Code per the Kira Sprint 1-2 build spec. Does not touch PM2, Nginx,
// or any other Ceronix package.
// =============================================================================

import "./types.js";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import { authMiddleware } from "./middleware/auth.js";
import { tierMiddleware } from "./middleware/tier.js";
import webhooksRouter from "./routes/webhooks.js";
import telegramRouter from "./routes/telegram.js";
import authRouter from "./routes/auth.js";
import meRouter from "./routes/me.js";
import rosterRouter from "./routes/roster.js";
import tokenRouter from "./routes/token.js";
import alertsRouter from "./routes/alerts.js";

const app = express();
const PORT = Number(process.env.KIRA_API_PORT || 4020);

app.use(helmet());

const allowedOrigins = new Set([
  "https://kira.ceronix.ai",
  "http://localhost:5173",
  "http://localhost:3000",
]);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Not allowed by CORS"));
    },
  }),
);

app.use(express.json({ limit: "1mb" }));

app.use((req, _res, next) => {
  console.log(`[kira-api] ${req.method} ${req.path}`);
  next();
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", version: "0.1.0", timestamp: new Date().toISOString() });
});

// No auth: Helius verifies via its own secret header, checked inside the handler.
app.use("/webhooks", webhooksRouter);

// No Supabase JWT auth: there is no user yet on first /start, gated by the internal bot-token
// header instead (see routes/telegram.ts).
app.use("/telegram", telegramRouter);

// Everything below requires a Supabase JWT and a resolved tier.
app.use(authMiddleware);
app.use(tierMiddleware);

app.use("/auth", authRouter);
app.use("/me", meRouter);
app.use("/roster", rosterRouter);
app.use("/token", tokenRouter);
app.use("/alerts", alertsRouter);

app.listen(PORT, () => {
  console.log(`[kira-api] listening on port ${PORT}`);
});
