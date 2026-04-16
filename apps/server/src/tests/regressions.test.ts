import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { SettingsService } from "../services/settingsService";
import { supportedProviders } from "../providers/providerCatalog";
import { AliasRepository } from "../repositories/aliasRepository";
import { AuditLogRepository } from "../repositories/auditLogRepository";
import { SchedulerJobRepository } from "../repositories/schedulerJobRepository";
import { createSecretVerificationToken, encryptSecret } from "../lib/secrets";
import { ExpirationScheduler } from "../services/expirationScheduler";
import { Alias } from "../domain/alias";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE aliases (
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

    CREATE TABLE audit_logs (
      id TEXT PRIMARY KEY,
      alias_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(alias_id) REFERENCES aliases(id)
    );

    CREATE TABLE app_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      alias_domain TEXT NOT NULL,
      providers_json TEXT,
      active_provider_id TEXT,
      forward_addresses_json TEXT NOT NULL,
      history_retention_days INTEGER NOT NULL DEFAULT 60,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE scheduler_jobs (
      id TEXT PRIMARY KEY,
      last_started_at TEXT,
      last_finished_at TEXT,
      last_outcome TEXT NOT NULL DEFAULT 'idle',
      last_summary TEXT
    );
  `);

  return db;
}

test("replacing a provider key invalidates readiness until it is retested", () => {
  const db = createTestDb();
  const aliasRepository = new AliasRepository(db);
  const auditLogRepository = new AuditLogRepository(db);
  const schedulerJobRepository = new SchedulerJobRepository(db);
  const settingsService = new SettingsService(
    db,
    "admin",
    1000 * 60 * 60,
    supportedProviders,
    aliasRepository,
    auditLogRepository
  );

  const providerId = "provider-simplelogin";
  db.prepare(`
    INSERT INTO app_settings (
      id, alias_domain, providers_json, active_provider_id, forward_addresses_json, history_retention_days, updated_at
    ) VALUES (1, '', ?, ?, ?, 60, ?)
  `).run(
    JSON.stringify([
      {
        id: providerId,
        type: "simplelogin",
        name: "SimpleLogin",
        config: {
          apiKey: encryptSecret("old-key"),
          hasStoredSecret: true,
          clearStoredSecret: false,
          lastConnectionTestSucceededAt: "2026-04-15T12:00:00.000Z",
          lastConnectionTestVerificationToken: createSecretVerificationToken("old-key")
        }
      }
    ]),
    providerId,
    JSON.stringify(["me@example.com"]),
    new Date().toISOString()
  );

  assert.throws(
    () =>
      settingsService.updateSettings({
        providerSettings: {
          providers: [
            {
              id: providerId,
              type: "simplelogin",
              name: "SimpleLogin",
              config: {
                apiKey: "new-key",
                hasStoredSecret: true,
                clearStoredSecret: false,
                // Simulates a client attempting to carry the previous successful test forward.
                lastConnectionTestSucceededAt: "2026-04-15T12:00:00.000Z",
                lastConnectionTestVerificationToken: createSecretVerificationToken("old-key")
              }
            }
          ],
          activeProviderId: providerId
        },
        uiSettings: {
          forwardAddresses: ["me@example.com"]
        },
        lifecycleSettings: {
          historyRetentionDays: 60
        }
      }),
    /not ready yet/
  );
});

test("failed expiration attempts leave local status unchanged and are not counted as successful expirations", async () => {
  const db = createTestDb();
  const aliasRepository = new AliasRepository(db);
  const auditLogRepository = new AuditLogRepository(db);
  const schedulerJobRepository = new SchedulerJobRepository(db);
  const settingsService = new SettingsService(
    db,
    "admin",
    1000 * 60 * 60,
    supportedProviders,
    aliasRepository,
    auditLogRepository
  );

  db.prepare(`
    INSERT INTO app_settings (
      id, alias_domain, providers_json, active_provider_id, forward_addresses_json, history_retention_days, updated_at
    ) VALUES (1, '', ?, ?, ?, 60, ?)
  `).run(
    JSON.stringify([
      {
        id: "provider-simplelogin",
        type: "simplelogin",
        name: "SimpleLogin",
        config: {
          apiKey: encryptSecret("real-key"),
          hasStoredSecret: true,
          clearStoredSecret: false,
          lastConnectionTestSucceededAt: "2026-04-15T12:00:00.000Z",
          lastConnectionTestVerificationToken: createSecretVerificationToken("real-key")
        }
      }
    ]),
    "provider-simplelogin",
    JSON.stringify(["me@example.com"]),
    new Date().toISOString()
  );

  const alias: Alias = {
    id: "alias-1",
    email: "cedar@example.com",
    providerName: "simplelogin",
    providerAliasId: "remote-alias-1",
    destinationEmail: "me@example.com",
    createdAt: "2026-04-15T10:00:00.000Z",
    expiresAt: "2026-04-15T10:30:00.000Z",
    status: "active",
    label: null
  };
  aliasRepository.create(alias);

  const failingProviderRegistry = {
    getProvider: () => ({
      deleteAlias: async () => {
        throw new Error("provider delete failed");
      }
    }),
    isImplemented: () => true
  } as unknown as ConstructorParameters<typeof ExpirationScheduler>[3];

  const scheduler = new ExpirationScheduler(
    aliasRepository,
    auditLogRepository,
    schedulerJobRepository,
    failingProviderRegistry,
    settingsService,
    60_000,
    24 * 60 * 60 * 1000,
    60 * 60 * 1000
  );

  const expiredCount = await scheduler.runOnce();
  assert.equal(expiredCount, 0);

  const storedAlias = aliasRepository.findById(alias.id);
  assert.equal(storedAlias?.status, "active");

  const expirationJob = scheduler.listJobs().find((job) => job.id === "expiration-sweep");
  assert.ok(expirationJob);
  assert.equal(expirationJob.lastOutcome, "success");
  assert.equal(expirationJob.lastSummary, "Expired 0 aliases. 1 expiration attempt failed.");
});

test("job run metadata persists across scheduler instances", async () => {
  const db = createTestDb();
  const aliasRepository = new AliasRepository(db);
  const auditLogRepository = new AuditLogRepository(db);
  const schedulerJobRepository = new SchedulerJobRepository(db);
  const settingsService = new SettingsService(
    db,
    "admin",
    1000 * 60 * 60,
    supportedProviders,
    aliasRepository,
    auditLogRepository
  );

  db.prepare(`
    INSERT INTO app_settings (
      id, alias_domain, providers_json, active_provider_id, forward_addresses_json, history_retention_days, updated_at
    ) VALUES (1, '', ?, ?, ?, 60, ?)
  `).run(
    JSON.stringify([]),
    null,
    JSON.stringify(["me@example.com"]),
    new Date().toISOString()
  );

  const providerRegistry = {
    getProvider: () => {
      throw new Error("No provider should be requested.");
    },
    isImplemented: () => true
  } as unknown as ConstructorParameters<typeof ExpirationScheduler>[3];

  const scheduler = new ExpirationScheduler(
    aliasRepository,
    auditLogRepository,
    schedulerJobRepository,
    providerRegistry,
    settingsService,
    60_000,
    24 * 60 * 60 * 1000,
    60 * 60 * 1000
  );

  await scheduler.syncProvidersNow();

  const reloadedScheduler = new ExpirationScheduler(
    aliasRepository,
    auditLogRepository,
    schedulerJobRepository,
    providerRegistry,
    settingsService,
    60_000,
    24 * 60 * 60 * 1000,
    60 * 60 * 1000
  );

  const providerSyncJob = reloadedScheduler.listJobs().find((job) => job.id === "provider-sync");
  assert.ok(providerSyncJob);
  assert.equal(providerSyncJob.lastOutcome, "success");
  assert.equal(providerSyncJob.lastSummary, "No providers needed reconciliation.");
  assert.equal(typeof providerSyncJob.lastFinishedAt, "string");
});

test("a newly tested replacement provider key can be saved when its verification token matches", () => {
  const db = createTestDb();
  const aliasRepository = new AliasRepository(db);
  const auditLogRepository = new AuditLogRepository(db);
  const settingsService = new SettingsService(
    db,
    "admin",
    1000 * 60 * 60,
    supportedProviders,
    aliasRepository,
    auditLogRepository
  );

  const providerId = "provider-simplelogin";
  db.prepare(`
    INSERT INTO app_settings (
      id, alias_domain, providers_json, active_provider_id, forward_addresses_json, history_retention_days, updated_at
    ) VALUES (1, '', ?, ?, ?, 60, ?)
  `).run(
    JSON.stringify([
      {
        id: providerId,
        type: "simplelogin",
        name: "SimpleLogin",
        config: {
          apiKey: encryptSecret("old-key"),
          hasStoredSecret: true,
          clearStoredSecret: false,
          lastConnectionTestSucceededAt: "2026-04-15T12:00:00.000Z",
          lastConnectionTestVerificationToken: createSecretVerificationToken("old-key")
        }
      }
    ]),
    providerId,
    JSON.stringify(["me@example.com"]),
    new Date().toISOString()
  );

  const testedAt = "2026-04-15T13:00:00.000Z";
  settingsService.updateSettings({
    providerSettings: {
      providers: [
        {
          id: providerId,
          type: "simplelogin",
          name: "SimpleLogin",
          config: {
            apiKey: "new-key",
            hasStoredSecret: true,
            clearStoredSecret: false,
            lastConnectionTestSucceededAt: testedAt,
            lastConnectionTestVerificationToken: createSecretVerificationToken("new-key")
          }
        }
      ],
      activeProviderId: providerId
    },
    uiSettings: {
      forwardAddresses: ["me@example.com"]
    },
    lifecycleSettings: {
      historyRetentionDays: 60
    }
  });

  const activeProvider = settingsService.getActiveProvider();
  assert.equal(activeProvider?.type, "simplelogin");
  if (activeProvider?.type !== "simplelogin") {
    throw new Error("Expected a SimpleLogin provider.");
  }

  assert.equal(activeProvider.config.apiKey, "new-key");
  assert.equal(activeProvider.config.lastConnectionTestSucceededAt, testedAt);
  assert.equal(
    activeProvider.config.lastConnectionTestVerificationToken,
    createSecretVerificationToken("new-key")
  );
});

test("provider-backed setups can save settings without any fallback forward addresses", () => {
  const db = createTestDb();
  const aliasRepository = new AliasRepository(db);
  const auditLogRepository = new AuditLogRepository(db);
  const settingsService = new SettingsService(
    db,
    "admin",
    1000 * 60 * 60,
    supportedProviders,
    aliasRepository,
    auditLogRepository
  );

  const providerId = "provider-simplelogin";
  db.prepare(`
    INSERT INTO app_settings (
      id, alias_domain, providers_json, active_provider_id, forward_addresses_json, history_retention_days, updated_at
    ) VALUES (1, '', ?, ?, ?, 60, ?)
  `).run(
    JSON.stringify([
      {
        id: providerId,
        type: "simplelogin",
        name: "SimpleLogin",
        config: {
          apiKey: encryptSecret("real-key"),
          hasStoredSecret: true,
          clearStoredSecret: false,
          lastConnectionTestSucceededAt: "2026-04-15T12:00:00.000Z",
          lastConnectionTestVerificationToken: createSecretVerificationToken("real-key")
        }
      }
    ]),
    providerId,
    JSON.stringify(["me@example.com"]),
    new Date().toISOString()
  );

  settingsService.updateSettings({
    providerSettings: {
      providers: [
        {
          id: providerId,
          type: "simplelogin",
          name: "SimpleLogin",
          config: {
            apiKey: "",
            hasStoredSecret: true,
            clearStoredSecret: false,
            lastConnectionTestSucceededAt: "2026-04-15T12:00:00.000Z",
            lastConnectionTestVerificationToken: createSecretVerificationToken("real-key")
          }
        }
      ],
      activeProviderId: providerId
    },
    uiSettings: {
      forwardAddresses: []
    },
    lifecycleSettings: {
      historyRetentionDays: 60
    }
  });

  assert.deepEqual(settingsService.getInternalSettings().uiSettings.forwardAddresses, []);
});
