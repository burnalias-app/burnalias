import Database from "better-sqlite3";
import { config } from "../config";
import { logger } from "../lib/logger";

const log = logger.child({ module: "database" });

const DEFAULT_MOCK_PROVIDER_ID = "provider-mock";

function buildDefaultProvidersJson(aliasDomain: string): string {
  return JSON.stringify([
    {
      id: DEFAULT_MOCK_PROVIDER_ID,
      type: "mock",
      name: "Mock provider",
      enabled: true,
      config: {
        aliasDomain
      }
    }
  ]);
}

function columnExists(db: Database.Database, tableName: string, columnName: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return columns.some((column) => column.name === columnName);
}

export function createDatabase(): Database.Database {
  log.info({ path: config.databasePath }, "Opening database");
  const db = new Database(config.databasePath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS aliases (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      provider_name TEXT NOT NULL,
      provider_alias_id TEXT NOT NULL,
      destination_email TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT,
      status TEXT NOT NULL CHECK (status IN ('active', 'disabled', 'expired')),
      label TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_aliases_status ON aliases(status);
    CREATE INDEX IF NOT EXISTS idx_aliases_expires_at ON aliases(expires_at);

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      alias_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(alias_id) REFERENCES aliases(id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      csrf_token TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      alias_domain TEXT NOT NULL,
      providers_json TEXT,
      active_provider_id TEXT,
      forward_addresses_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  if (!columnExists(db, "sessions", "csrf_token")) {
    log.debug("Running migration: add sessions.csrf_token");
    db.exec(`ALTER TABLE sessions ADD COLUMN csrf_token TEXT`);
  }

  if (!columnExists(db, "app_settings", "providers_json")) {
    log.debug("Running migration: add app_settings.providers_json");
    db.exec(`ALTER TABLE app_settings ADD COLUMN providers_json TEXT`);
  }

  if (!columnExists(db, "app_settings", "active_provider_id")) {
    log.debug("Running migration: add app_settings.active_provider_id");
    db.exec(`ALTER TABLE app_settings ADD COLUMN active_provider_id TEXT`);
  }

  const existingSettings = db.prepare(`SELECT COUNT(*) as count FROM app_settings WHERE id = 1`).get() as {
    count: number;
  };
  if (existingSettings.count === 0) {
    db.prepare(`
      INSERT INTO app_settings (id, alias_domain, providers_json, active_provider_id, forward_addresses_json, updated_at)
      VALUES (1, ?, ?, ?, ?, ?)
    `).run(
      config.mockProviderDomain,
      buildDefaultProvidersJson(config.mockProviderDomain),
      DEFAULT_MOCK_PROVIDER_ID,
      JSON.stringify(config.forwardAddresses),
      new Date().toISOString()
    );
  } else {
    const settingsRow = db
      .prepare(`
        SELECT alias_domain, providers_json, active_provider_id
        FROM app_settings
        WHERE id = 1
      `)
      .get() as {
        alias_domain: string;
        providers_json: string | null;
        active_provider_id: string | null;
      };

    const nextProvidersJson =
      settingsRow.providers_json && settingsRow.providers_json.trim().length > 0
        ? settingsRow.providers_json
        : buildDefaultProvidersJson(settingsRow.alias_domain ?? config.mockProviderDomain);
    const nextActiveProviderId = settingsRow.active_provider_id ?? DEFAULT_MOCK_PROVIDER_ID;

    db.prepare(`
      UPDATE app_settings
      SET providers_json = ?,
          active_provider_id = ?
      WHERE id = 1
    `).run(nextProvidersJson, nextActiveProviderId);
  }

  log.info("Database ready");
  return db;
}
