import path from "path";
import dotenv from "dotenv";
import { createHash } from "crypto";

dotenv.config();

const authUsername = process.env.BURN_USER ?? null;
const authPasswordHash = process.env.BURN_PASSWORD_HASH ?? null;
const derivedSessionSecret =
  authUsername && authPasswordHash
    ? createHash("sha256").update(`${authUsername}:${authPasswordHash}`).digest("hex")
    : null;

export const config = {
  port: Number(process.env.PORT ?? 3001),
  nodeEnv: process.env.NODE_ENV ?? "development",
  logLevel: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
  databasePath: process.env.DATABASE_PATH
    ? path.resolve(process.cwd(), process.env.DATABASE_PATH)
    : path.resolve(__dirname, "../../../data/burnalias.db"),
  mockProviderDomain: process.env.MOCK_PROVIDER_DOMAIN ?? "burnalias.test",
  expirationCheckIntervalMs: Number(process.env.EXPIRATION_CHECK_INTERVAL_MS ?? 60_000),
  forwardAddresses: (process.env.FORWARD_ADDRESSES ?? "me@example.com")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  authUsername,
  authPasswordHash,
  sessionSecret: process.env.BURN_SESSION_SECRET ?? derivedSessionSecret,
  sessionTtlMs: Number(process.env.BURN_SESSION_TTL_MS ?? 1000 * 60 * 60 * 24 * 7),
  loginRateLimitWindowMs: Number(process.env.BURN_LOGIN_RATE_LIMIT_WINDOW_MS ?? 15 * 60 * 1000),
  loginRateLimitMaxAttempts: Number(process.env.BURN_LOGIN_RATE_LIMIT_MAX_ATTEMPTS ?? 5)
};
