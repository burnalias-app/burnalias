import Database from "better-sqlite3";
import { config } from "../config";
import { createId } from "../lib/id";
import { logger } from "../lib/logger";

const log = logger.child({ module: "database" });

function columnExists(db: Database.Database, tableName: string, columnName: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return columns.some((column) => column.name === columnName);
}

function migrateRemovedProviders(
  db: Database.Database,
  removedProviderTypes: string[],
  eventType: string,
  messageBuilder: (providerType: string, email: string) => string
): void {
  const settingsRow = db
    .prepare(`
      SELECT providers_json, active_provider_id
      FROM app_settings
      WHERE id = 1
    `)
    .get() as {
      providers_json: string | null;
      active_provider_id: string | null;
    };

  let providers: Array<{ type: string; id: string }> = [];
  try {
    const raw = settingsRow.providers_json?.trim();
    if (raw) providers = JSON.parse(raw) as Array<{ type: string; id: string }>;
  } catch {
    // Ignore malformed JSON and leave provider cleanup to later validation paths.
  }

  const removedProviders = providers.filter((provider) => removedProviderTypes.includes(provider.type));
  const placeholders = removedProviderTypes.map(() => "?").join(", ");
  const affectedAliases = removedProviderTypes.length
    ? (db
        .prepare(`
          SELECT id, email, provider_name
          FROM aliases
          WHERE provider_name IN (${placeholders})
            AND status IN ('active', 'inactive')
        `)
        .all(...removedProviderTypes) as Array<{ id: string; email: string; provider_name: string }>)
    : [];

  if (removedProviders.length === 0 && affectedAliases.length === 0) {
    return;
  }

  const nowIso = new Date().toISOString();
  const updateMockAliases = db.prepare(`
    UPDATE aliases
    SET status = 'deleted',
        status_changed_at = ?
    WHERE id = ?
  `);
  const insertAuditLog = db.prepare(`
    INSERT INTO audit_logs (id, alias_id, event_type, message, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const updateSettings = db.prepare(`
    UPDATE app_settings
    SET providers_json = ?,
        active_provider_id = ?,
        updated_at = ?
    WHERE id = 1
  `);

  const filteredProviders = providers.filter((provider) => !removedProviderTypes.includes(provider.type));
  const nextActiveProviderId = filteredProviders.some((provider) => provider.id === settingsRow.active_provider_id)
    ? settingsRow.active_provider_id
    : filteredProviders[0]?.id ?? null;

  const transaction = db.transaction(() => {
    for (const alias of affectedAliases) {
      updateMockAliases.run(nowIso, alias.id);
      insertAuditLog.run(
        createId(),
        alias.id,
        eventType,
        messageBuilder(alias.provider_name, alias.email),
        nowIso
      );
    }

    updateSettings.run(JSON.stringify(filteredProviders), nextActiveProviderId, nowIso);
  });

  transaction();

  log.info(
    {
      migratedAliasCount: affectedAliases.length,
      removedProviderCount: removedProviders.length,
      removedProviderTypes
    },
    "Migrated removed provider state"
  );
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
      status TEXT NOT NULL CHECK (status IN ('active', 'inactive', 'expired', 'deleted')),
      status_changed_at TEXT NOT NULL,
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
      history_retention_days INTEGER NOT NULL DEFAULT 60,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scheduler_jobs (
      id TEXT PRIMARY KEY,
      last_started_at TEXT,
      last_finished_at TEXT,
      last_outcome TEXT NOT NULL DEFAULT 'idle',
      last_summary TEXT
    );
  `);

  const aliasesSql = (
    db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'aliases'`).get() as
      | { sql: string }
      | undefined
  )?.sql;
  if (!aliasesSql?.includes("'inactive'") || !columnExists(db, "aliases", "status_changed_at")) {
    log.info("Running migration: rebuild aliases table for lifecycle statuses");
    db.pragma("foreign_keys = OFF");
    try {
      db.exec(`
        DROP TABLE IF EXISTS aliases_new;

        CREATE TABLE aliases_new (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          provider_name TEXT NOT NULL,
          provider_alias_id TEXT NOT NULL,
          destination_email TEXT NOT NULL,
          created_at TEXT NOT NULL,
          expires_at TEXT,
          status TEXT NOT NULL CHECK (status IN ('active', 'inactive', 'expired', 'deleted')),
          status_changed_at TEXT NOT NULL,
          label TEXT
        );

        INSERT INTO aliases_new (
          id, email, provider_name, provider_alias_id, destination_email, created_at, expires_at, status, status_changed_at, label
        )
        SELECT
          id,
          email,
          provider_name,
          provider_alias_id,
          destination_email,
          created_at,
          expires_at,
          CASE status
            WHEN 'disabled' THEN 'inactive'
            ELSE status
          END,
          created_at,
          label
        FROM aliases;

        DROP TABLE aliases;
        ALTER TABLE aliases_new RENAME TO aliases;

        CREATE INDEX IF NOT EXISTS idx_aliases_status ON aliases(status);
        CREATE INDEX IF NOT EXISTS idx_aliases_expires_at ON aliases(expires_at);
      `);
    } finally {
      db.pragma("foreign_keys = ON");
    }
  }

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

  if (!columnExists(db, "app_settings", "history_retention_days")) {
    log.debug("Running migration: add app_settings.history_retention_days");
    db.exec(`ALTER TABLE app_settings ADD COLUMN history_retention_days INTEGER NOT NULL DEFAULT 60`);
  }

  const existingSettings = db.prepare(`SELECT COUNT(*) as count FROM app_settings WHERE id = 1`).get() as {
    count: number;
  };
  if (existingSettings.count === 0) {
    db.prepare(`
      INSERT INTO app_settings (id, alias_domain, providers_json, active_provider_id, forward_addresses_json, updated_at)
      VALUES (1, ?, ?, ?, ?, ?)
    `).run(
      "",
      JSON.stringify([]),
      null,
      JSON.stringify([]),
      new Date().toISOString()
    );
  } else {
    migrateRemovedProviders(
      db,
      ["mock"],
      "alias.deleted",
      (_providerType, email) =>
        `Legacy mock provider was removed from BurnAlias. Alias ${email} was marked deleted locally.`
    );
    migrateRemovedProviders(
      db,
      ["cloudflare"],
      "provider.removed",
      (_providerType, email) =>
        `Cloudflare Email Routing was removed from BurnAlias. Alias ${email} remains only for historical reference.`
    );
  }

  log.info("Database ready");
  return db;
}
