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
import { AliasService } from "../services/aliasService";

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

function buildSimpleLoginProvider(providerId: string, apiKey = "real-key") {
  return {
    id: providerId,
    type: "simplelogin" as const,
    name: "SimpleLogin",
    config: {
      apiKey: encryptSecret(apiKey),
      hasStoredSecret: true,
      clearStoredSecret: false,
      lastConnectionTestSucceededAt: "2026-04-15T12:00:00.000Z",
      lastConnectionTestVerificationToken: createSecretVerificationToken(apiKey)
    }
  };
}

function insertSettings(
  db: Database.Database,
  {
    providers = [],
    activeProviderId = null,
    forwardAddresses = ["me@example.com"]
  }: {
    providers?: unknown[];
    activeProviderId?: string | null;
    forwardAddresses?: string[];
  } = {}
): void {
  db.prepare(`
    INSERT INTO app_settings (
      id, alias_domain, providers_json, active_provider_id, forward_addresses_json, history_retention_days, updated_at
    ) VALUES (1, '', ?, ?, ?, 60, ?)
  `).run(
    JSON.stringify(providers),
    activeProviderId,
    JSON.stringify(forwardAddresses),
    new Date().toISOString()
  );
}

function buildAlias(overrides: Partial<Alias> = {}): Alias {
  return {
    id: overrides.id ?? "alias-1",
    email: overrides.email ?? "cedar@example.com",
    providerName: overrides.providerName ?? "simplelogin",
    providerAliasId: overrides.providerAliasId ?? "remote-alias-1",
    destinationEmail: overrides.destinationEmail ?? "me@example.com",
    createdAt: overrides.createdAt ?? "2026-04-15T10:00:00.000Z",
    expiresAt: overrides.expiresAt ?? "2026-04-15T10:30:00.000Z",
    status: overrides.status ?? "active",
    label: overrides.label ?? null
  };
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
  insertSettings(db, {
    providers: [buildSimpleLoginProvider(providerId, "old-key")],
    activeProviderId: providerId
  });

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

  insertSettings(db, {
    providers: [buildSimpleLoginProvider("provider-simplelogin")],
    activeProviderId: "provider-simplelogin"
  });

  const alias: Alias = buildAlias();
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
  assert.equal(expirationJob.lastSummary, "Expired 0 aliases; 1 expiration attempt failed.");
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

  insertSettings(db);

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
  insertSettings(db, {
    providers: [buildSimpleLoginProvider(providerId, "old-key")],
    activeProviderId: providerId
  });

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
  insertSettings(db, {
    providers: [buildSimpleLoginProvider(providerId)],
    activeProviderId: providerId
  });

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
    lifecycleSettings: {
      historyRetentionDays: 60
    }
  });
});

test("alias lifecycle transitions update provider and local status correctly", async () => {
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
  insertSettings(db, {
    providers: [buildSimpleLoginProvider(providerId)],
    activeProviderId: providerId
  });

  const providerCalls: string[] = [];
  const providerRegistry = {
    isImplemented: () => true,
    getProvider: () => ({
      name: "simplelogin",
      updateAliasMetadata: async () => undefined,
      enableAlias: async () => {
        providerCalls.push("enable");
      },
      disableAlias: async () => {
        providerCalls.push("disable");
      },
      deleteAlias: async () => {
        providerCalls.push("delete");
      }
    })
  } as unknown as ConstructorParameters<typeof AliasService>[2];

  const aliasService = new AliasService(aliasRepository, auditLogRepository, providerRegistry, settingsService);
  const alias = buildAlias();
  aliasRepository.create(alias);

  const inactiveAlias = await aliasService.setAliasStatus(alias.id, "inactive");
  assert.equal(inactiveAlias.status, "inactive");
  assert.equal(aliasRepository.findById(alias.id)?.status, "inactive");

  const activeAlias = await aliasService.setAliasStatus(alias.id, "active");
  assert.equal(activeAlias.status, "active");
  assert.equal(aliasRepository.findById(alias.id)?.status, "active");

  await aliasService.deleteAlias(alias.id);
  assert.equal(aliasRepository.findById(alias.id)?.status, "deleted");
  assert.deepEqual(providerCalls, ["disable", "enable", "delete"]);

  const auditEvents = auditLogRepository.listForAlias(alias.id).map((entry) => entry.eventType);
  assert.ok(auditEvents.includes("alias.deleted"));
  assert.ok(auditEvents.includes("alias.enabled"));
  assert.ok(auditEvents.includes("alias.inactive"));
});

test("terminal aliases cannot be reactivated or have expiration updated", async () => {
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

  insertSettings(db);

  const providerRegistry = {
    isImplemented: () => true,
    getProvider: () => ({
      name: "simplelogin",
      updateAliasMetadata: async () => undefined,
      enableAlias: async () => undefined,
      disableAlias: async () => undefined,
      deleteAlias: async () => undefined
    })
  } as unknown as ConstructorParameters<typeof AliasService>[2];

  const aliasService = new AliasService(aliasRepository, auditLogRepository, providerRegistry, settingsService);
  const terminalAlias = buildAlias({ id: "alias-terminal", status: "expired" });
  aliasRepository.create(terminalAlias);
  aliasRepository.updateStatus(terminalAlias.id, "expired");

  await assert.rejects(
    () => aliasService.setAliasStatus(terminalAlias.id, "active"),
    /Terminal aliases cannot be reactivated/
  );

  await assert.rejects(
    () => aliasService.updateExpiration(terminalAlias.id, 24),
    /Cannot update expiration on a terminal alias/
  );
});

test("updating expiration also refreshes the provider note with label and expiration", async () => {
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

  insertSettings(db, {
    providers: [buildSimpleLoginProvider("provider-simplelogin")],
    activeProviderId: "provider-simplelogin"
  });

  const metadataUpdates: Array<{ id: string; note: string | null | undefined }> = [];
  const providerRegistry = {
    isImplemented: () => true,
    getProvider: () => ({
      name: "simplelogin",
      updateAliasMetadata: async (providerAliasId: string, input: { note?: string | null }) => {
        metadataUpdates.push({ id: providerAliasId, note: input.note });
      },
      enableAlias: async () => undefined,
      disableAlias: async () => undefined,
      deleteAlias: async () => undefined
    })
  } as unknown as ConstructorParameters<typeof AliasService>[2];

  const aliasService = new AliasService(aliasRepository, auditLogRepository, providerRegistry, settingsService);
  const alias = buildAlias({ id: "alias-expiration", label: "Shopping" });
  aliasRepository.create(alias);

  const updated = await aliasService.updateExpiration(alias.id, 24);

  assert.equal(updated.id, alias.id);
  assert.equal(metadataUpdates.length, 1);
  assert.equal(metadataUpdates[0]?.id, alias.providerAliasId);
  assert.match(metadataUpdates[0]?.note ?? "", /^Label: Shopping \| BurnAlias expiration: /);
});

test("updating alias metadata refreshes the provider destination and note", async () => {
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

  insertSettings(db, {
    providers: [buildSimpleLoginProvider("provider-simplelogin")],
    activeProviderId: "provider-simplelogin"
  });

  const metadataUpdates: Array<{
    id: string;
    note: string | null | undefined;
    destinationEmail?: string;
  }> = [];
  const providerRegistry = {
    isImplemented: () => true,
    getProvider: () => ({
      name: "simplelogin",
      updateAliasMetadata: async (
        providerAliasId: string,
        input: { note?: string | null; destinationEmail?: string }
      ) => {
        metadataUpdates.push({
          id: providerAliasId,
          note: input.note,
          destinationEmail: input.destinationEmail
        });
      },
      enableAlias: async () => undefined,
      disableAlias: async () => undefined,
      deleteAlias: async () => undefined
    })
  } as unknown as ConstructorParameters<typeof AliasService>[2];

  const aliasService = new AliasService(aliasRepository, auditLogRepository, providerRegistry, settingsService);
  const alias = buildAlias({ id: "alias-metadata", label: "Old label", destinationEmail: "old@example.com" });
  aliasRepository.create(alias);

  const updated = await aliasService.updateMetadata(alias.id, {
    destinationEmail: "new@example.com",
    label: "New label"
  });

  assert.equal(updated.destinationEmail, "new@example.com");
  assert.equal(updated.label, "New label");
  assert.deepEqual(metadataUpdates, [
    {
      id: alias.providerAliasId,
      note: "Label: New label | BurnAlias expiration: 2026-04-15T10:30:00.000Z",
      destinationEmail: "new@example.com"
    }
  ]);
  assert.equal(aliasRepository.findById(alias.id)?.destinationEmail, "new@example.com");
  assert.equal(aliasRepository.findById(alias.id)?.label, "New label");
});

test("provider sync keeps BurnAlias as the source of truth for label and forward target", async () => {
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

  insertSettings(db, {
    providers: [buildSimpleLoginProvider("provider-simplelogin")],
    activeProviderId: "provider-simplelogin"
  });

  const activeAlias = buildAlias({
    id: "alias-active",
    providerAliasId: "remote-active",
    status: "inactive",
    destinationEmail: "burn-active@example.com",
    label: "Burn active"
  });
  const inactiveAlias = buildAlias({
    id: "alias-inactive",
    providerAliasId: "remote-inactive",
    status: "active",
    destinationEmail: "keep-local@example.com",
    label: "Keep local"
  });
  const relabeledAlias = buildAlias({
    id: "alias-relabeled",
    providerAliasId: "remote-relabeled",
    status: "active",
    destinationEmail: "old-push@example.com",
    label: "Push me"
  });
  const missingAlias = buildAlias({ id: "alias-missing", providerAliasId: "remote-missing", status: "active" });
  aliasRepository.create(activeAlias);
  aliasRepository.create(inactiveAlias);
  aliasRepository.create(relabeledAlias);
  aliasRepository.create(missingAlias);

  const pushedMetadata: Array<{ id: string; note: string | null | undefined; destinationEmail?: string }> = [];
  const providerRegistry = {
    isImplemented: () => true,
    getProvider: () => ({
      updateAliasMetadata: async (
        providerAliasId: string,
        input: { note?: string | null; destinationEmail?: string }
      ) => {
        pushedMetadata.push({
          id: providerAliasId,
          note: input.note,
          destinationEmail: input.destinationEmail
        });
      },
      listAliases: async () => [
        {
          id: "remote-active",
          email: activeAlias.email,
          destinationEmail: "provider-active@example.com",
          enabled: true,
          label: "Provider active"
        },
        {
          id: "remote-inactive",
          email: inactiveAlias.email,
          destinationEmail: "provider-changed@example.com",
          enabled: false,
          label: "Provider label"
        },
        {
          id: "remote-relabeled",
          email: relabeledAlias.email,
          destinationEmail: "provider-empty@example.com",
          enabled: true,
          label: null
        }
      ]
    })
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

  assert.equal(aliasRepository.findById(activeAlias.id)?.status, "active");
  assert.equal(aliasRepository.findById(activeAlias.id)?.destinationEmail, "burn-active@example.com");
  assert.equal(aliasRepository.findById(activeAlias.id)?.label, "Burn active");
  assert.equal(aliasRepository.findById(inactiveAlias.id)?.status, "inactive");
  assert.equal(aliasRepository.findById(inactiveAlias.id)?.destinationEmail, "keep-local@example.com");
  assert.equal(aliasRepository.findById(inactiveAlias.id)?.label, "Keep local");
  assert.equal(aliasRepository.findById(relabeledAlias.id)?.status, "active");
  assert.equal(aliasRepository.findById(relabeledAlias.id)?.destinationEmail, "old-push@example.com");
  assert.equal(aliasRepository.findById(relabeledAlias.id)?.label, "Push me");
  assert.equal(aliasRepository.findById(missingAlias.id)?.status, "deleted");
  assert.deepEqual(pushedMetadata, [
    {
      id: "remote-active",
      note: "Label: Burn active | BurnAlias expiration: 2026-04-15T10:30:00.000Z",
      destinationEmail: "burn-active@example.com"
    },
    {
      id: "remote-inactive",
      note: "Label: Keep local | BurnAlias expiration: 2026-04-15T10:30:00.000Z",
      destinationEmail: "keep-local@example.com"
    },
    {
      id: "remote-relabeled",
      note: "Label: Push me | BurnAlias expiration: 2026-04-15T10:30:00.000Z"
      ,
      destinationEmail: "old-push@example.com"
    }
  ]);

  const syncJob = scheduler.listJobs().find((job) => job.id === "provider-sync");
  assert.ok(syncJob);
  assert.equal(syncJob.lastSummary, "Checked 1 provider, updated 3 aliases, and marked 1 deleted.");

  const missingAuditEvents = auditLogRepository.listForAlias(missingAlias.id).map((entry) => entry.eventType);
  assert.ok(missingAuditEvents.includes("alias.deleted"));
  const activeAuditEvents = auditLogRepository.listForAlias(activeAlias.id).map((entry) => entry.eventType);
  assert.ok(activeAuditEvents.includes("alias.label_pushed"));
  assert.ok(activeAuditEvents.includes("alias.destination_pushed"));
  const pushedLabelEvents = auditLogRepository.listForAlias(relabeledAlias.id).map((entry) => entry.eventType);
  assert.ok(pushedLabelEvents.includes("alias.label_pushed"));
  assert.ok(pushedLabelEvents.includes("alias.destination_pushed"));
});

test("provider sync communication failures leave alias state unchanged", async () => {
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

  insertSettings(db, {
    providers: [buildSimpleLoginProvider("provider-simplelogin")],
    activeProviderId: "provider-simplelogin"
  });

  const alias = buildAlias({ id: "alias-stable", status: "active" });
  aliasRepository.create(alias);

  const providerRegistry = {
    isImplemented: () => true,
    getProvider: () => ({
      listAliases: async () => {
        throw new Error("provider list failed");
      }
    })
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

  assert.equal(aliasRepository.findById(alias.id)?.status, "active");
  const syncJob = scheduler.listJobs().find((job) => job.id === "provider-sync");
  assert.ok(syncJob);
  assert.equal(syncJob.lastSummary, "No providers needed reconciliation.");
});

test("cannot remove a provider while non-terminal aliases are still attached", () => {
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
  insertSettings(db, {
    providers: [buildSimpleLoginProvider(providerId)],
    activeProviderId: providerId
  });

  aliasRepository.create(buildAlias({ id: "alias-live", status: "active" }));

  assert.throws(
    () =>
      settingsService.updateSettings({
        providerSettings: {
          providers: [],
          activeProviderId: null
        },
        lifecycleSettings: {
          historyRetentionDays: 60
        }
      }),
    /Cannot remove SimpleLogin while active or inactive aliases are still tied to it/
  );
});

test("removing a provider with only terminal aliases writes provider removal audit entries", () => {
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
  insertSettings(db, {
    providers: [buildSimpleLoginProvider(providerId)],
    activeProviderId: providerId
  });

  const deletedAlias = buildAlias({ id: "alias-deleted", status: "deleted" });
  const expiredAlias = buildAlias({ id: "alias-expired", status: "expired" });
  aliasRepository.create(deletedAlias);
  aliasRepository.updateStatus(deletedAlias.id, "deleted");
  aliasRepository.create(expiredAlias);
  aliasRepository.updateStatus(expiredAlias.id, "expired");

  settingsService.updateSettings({
    providerSettings: {
      providers: [],
      activeProviderId: null
    },
    lifecycleSettings: {
      historyRetentionDays: 60
    }
  });

  const deletedAudit = auditLogRepository.listForAlias(deletedAlias.id).find((entry) => entry.eventType === "provider.removed");
  const expiredAudit = auditLogRepository.listForAlias(expiredAlias.id).find((entry) => entry.eventType === "provider.removed");
  assert.ok(deletedAudit);
  assert.ok(expiredAudit);
});
