import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { createHash } from "crypto";
import { readOrCreatePersistentSecret } from "./lib/persistentSecret";

const serverRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(serverRoot, "..", "..");

function loadEnvFiles(): void {
  const candidates = [
    path.resolve(repoRoot, ".env"),
    path.resolve(serverRoot, ".env"),
    path.resolve(process.cwd(), ".env")
  ];
  const seen = new Set<string>();

  for (const envPath of candidates) {
    if (seen.has(envPath) || !fs.existsSync(envPath)) {
      continue;
    }

    seen.add(envPath);
    dotenv.config({ path: envPath, override: false });
  }
}

loadEnvFiles();

const authUsername = process.env.BURN_USER ?? null;
const authPasswordHash = process.env.BURN_PASSWORD_HASH ?? null;
const databasePath = process.env.DATABASE_PATH
  ? path.resolve(process.cwd(), process.env.DATABASE_PATH)
  : path.resolve(__dirname, "../../../data/burnalias.db");
const derivedSessionSecret =
  authUsername && authPasswordHash
    ? createHash("sha256").update(`${authUsername}:${authPasswordHash}`).digest("hex")
    : null;

const persistentSecretsKeyPath = process.env.BURN_SECRETS_KEY_PATH
  ? path.resolve(process.cwd(), process.env.BURN_SECRETS_KEY_PATH)
  : path.resolve(path.dirname(databasePath), ".burnalias-secrets-key");
const persistentSecretsKey = readOrCreatePersistentSecret(persistentSecretsKeyPath);

export const config = {
  port: Number(process.env.PORT ?? 3001),
  nodeEnv: process.env.NODE_ENV ?? "development",
  logLevel: process.env.BURN_LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
  databasePath,
  expirationCheckIntervalMs: Number(process.env.EXPIRATION_CHECK_INTERVAL_MS ?? 60_000),
  historyPurgeIntervalMs: Number(process.env.HISTORY_PURGE_INTERVAL_MS ?? 24 * 60 * 60 * 1000),
  providerSyncIntervalMs: Number(process.env.PROVIDER_SYNC_INTERVAL_MS ?? 60 * 60 * 1000),
  authUsername,
  authPasswordHash,
  sessionSecret: process.env.BURN_SESSION_SECRET ?? derivedSessionSecret,
  secretsKey: process.env.BURN_SECRETS_KEY ?? persistentSecretsKey,
  secretsKeyPath: process.env.BURN_SECRETS_KEY ? null : persistentSecretsKeyPath,
  sessionTtlMs: Number(process.env.BURN_SESSION_TTL_MS ?? 1000 * 60 * 60 * 24 * 7),
  loginRateLimitWindowMs: Number(process.env.BURN_LOGIN_RATE_LIMIT_WINDOW_MS ?? 15 * 60 * 1000),
  loginRateLimitMaxAttempts: Number(process.env.BURN_LOGIN_RATE_LIMIT_MAX_ATTEMPTS ?? 5)
};
