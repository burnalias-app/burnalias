import { Alias, ProviderAlias } from "../domain/alias";
import { createId } from "../lib/id";
import { logger } from "../lib/logger";
import { buildProviderNote } from "../lib/providerNotes";
import { ProviderRegistry } from "../providers/providerRegistry";
import { AliasRepository } from "../repositories/aliasRepository";
import { AuditLogRepository } from "../repositories/auditLogRepository";
import { SchedulerJobRepository, SchedulerJobOutcome } from "../repositories/schedulerJobRepository";
import { SettingsService } from "./settingsService";

const log = logger.child({ module: "expirationScheduler" });

export type SchedulerJobId = "expiration-sweep" | "terminal-history-purge" | "provider-sync";

export interface SchedulerJobStatus {
  id: SchedulerJobId;
  title: string;
  description: string;
  intervalMs: number;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  nextRunAt: string | null;
  isRunning: boolean;
  lastOutcome: SchedulerJobOutcome;
  lastSummary: string | null;
}

export class ExpirationScheduler {
  private timer: NodeJS.Timeout | null = null;
  private readonly startedAt = Date.now();
  private expirationPromise: Promise<number> | null = null;
  private purgePromise: Promise<number> | null = null;
  private providerSyncPromise: Promise<void> | null = null;
  private readonly jobs: Map<SchedulerJobId, Omit<SchedulerJobStatus, "nextRunAt">>;

  constructor(
    private readonly aliasRepository: AliasRepository,
    private readonly auditLogRepository: AuditLogRepository,
    private readonly schedulerJobRepository: SchedulerJobRepository,
    private readonly providerRegistry: ProviderRegistry,
    private readonly settingsService: SettingsService,
    private readonly intervalMs: number,
    private readonly historyPurgeIntervalMs: number,
    private readonly providerSyncIntervalMs: number
  ) {
    this.jobs = new Map<SchedulerJobId, Omit<SchedulerJobStatus, "nextRunAt">>([
      [
        "expiration-sweep",
        {
          id: "expiration-sweep",
          title: "Expiration sweep",
          description: "Removes expired aliases from the provider and marks them expired locally.",
          intervalMs: this.intervalMs,
          lastStartedAt: null,
          lastFinishedAt: null,
          isRunning: false,
          lastOutcome: "idle",
          lastSummary: null
        }
      ],
      [
        "terminal-history-purge",
        {
          id: "terminal-history-purge",
          title: "Terminal history purge",
          description: "Purges expired and deleted alias history after the configured retention window.",
          intervalMs: this.historyPurgeIntervalMs,
          lastStartedAt: null,
          lastFinishedAt: null,
          isRunning: false,
          lastOutcome: "idle",
          lastSummary: null
        }
      ],
      [
        "provider-sync",
        {
          id: "provider-sync",
          title: "Provider sync",
          description: "Reconciles BurnAlias alias state against configured providers and imports unknown aliases.",
          intervalMs: this.providerSyncIntervalMs,
          lastStartedAt: null,
          lastFinishedAt: null,
          isRunning: false,
          lastOutcome: "idle",
          lastSummary: null
        }
      ]
    ]);

    for (const persistedJob of this.schedulerJobRepository.list()) {
      const job = this.jobs.get(persistedJob.id);
      if (!job) {
        continue;
      }

      job.lastStartedAt = persistedJob.lastStartedAt;
      job.lastFinishedAt = persistedJob.lastFinishedAt;
      job.lastOutcome = persistedJob.lastOutcome;
      job.lastSummary = persistedJob.lastSummary;
    }
  }

  start(): void {
    log.info(
      {
        intervalMs: this.intervalMs,
        historyPurgeIntervalMs: this.historyPurgeIntervalMs,
        providerSyncIntervalMs: this.providerSyncIntervalMs
      },
      "Scheduler started"
    );
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.intervalMs);

    void this.runOnce();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      log.info("Scheduler stopped");
    }
  }

  async runOnce(): Promise<number> {
    const expirationCount = await this.runExpirationSweep();
    const purgedCount = this.shouldRunTerminalHistoryPurge()
      ? await this.runTerminalHistoryPurge()
      : 0;

    if (this.shouldRunProviderSync()) {
      await this.syncProvidersNow();
    }

    if (expirationCount > 0 || purgedCount > 0) {
      log.info(
        { expirationCount, purgedCount },
        `Lifecycle sweep completed: expired ${expirationCount}, purged ${purgedCount}.`
      );
    }

    return expirationCount + purgedCount;
  }

  async syncProvidersNow(): Promise<void> {
    if (this.providerSyncPromise) {
      return this.providerSyncPromise;
    }

    this.markJobStarted("provider-sync");
    this.providerSyncPromise = (async () => {
      try {
        const stats = await this.reconcileProviders();
        const summary =
          stats.providersChecked === 0
            ? "No providers needed reconciliation."
            : `Checked ${stats.providersChecked} provider${stats.providersChecked === 1 ? "" : "s"}, updated ${stats.aliasesUpdated} aliases, imported ${stats.aliasesImported}, and marked ${stats.aliasesMarkedDeleted} deleted.`;
        this.markJobFinished("provider-sync", "success", summary);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Provider sync failed.";
        this.markJobFinished("provider-sync", "error", message);
        throw err;
      }
    })().finally(() => {
      this.providerSyncPromise = null;
    });

    return this.providerSyncPromise;
  }

  async runJob(jobId: SchedulerJobId): Promise<void> {
    if (jobId === "provider-sync") {
      await this.syncProvidersNow();
      return;
    }

    if (jobId === "terminal-history-purge") {
      await this.runTerminalHistoryPurge();
      return;
    }

    await this.runExpirationSweep();
  }

  listJobs(): SchedulerJobStatus[] {
    return (["expiration-sweep", "terminal-history-purge", "provider-sync"] as SchedulerJobId[]).map((jobId) => {
      const job = this.jobs.get(jobId)!;
      return {
        ...job,
        nextRunAt: this.getNextRunAt(jobId)
      };
    });
  }

  private async runExpirationSweep(): Promise<number> {
    if (this.expirationPromise) {
      return this.expirationPromise;
    }

    this.markJobStarted("expiration-sweep");
    this.expirationPromise = (async () => {
      try {
        const nowIso = new Date().toISOString();
        const { expiredCount, failedCount } = await this.expireAliases(nowIso);
        const summary =
          failedCount > 0
            ? `Expired ${expiredCount} aliases; ${failedCount} expiration attempt${failedCount === 1 ? "" : "s"} failed.`
            : `Expired ${expiredCount} aliases.`;
        this.markJobFinished("expiration-sweep", "success", summary);
        return expiredCount;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Expiration sweep failed.";
        this.markJobFinished("expiration-sweep", "error", message);
        throw err;
      }
    })().finally(() => {
      this.expirationPromise = null;
    });

    return this.expirationPromise;
  }

  private async runTerminalHistoryPurge(): Promise<number> {
    if (this.purgePromise) {
      return this.purgePromise;
    }

    this.markJobStarted("terminal-history-purge");
    this.purgePromise = (async () => {
      try {
        const purgedCount = this.purgeTerminalHistory(new Date());
        const summary = `Purged ${purgedCount} terminal history records.`;
        this.markJobFinished("terminal-history-purge", "success", summary);
        return purgedCount;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Terminal history purge failed.";
        this.markJobFinished("terminal-history-purge", "error", message);
        throw err;
      }
    })().finally(() => {
      this.purgePromise = null;
    });

    return this.purgePromise;
  }

  private shouldRunProviderSync(): boolean {
    const job = this.jobs.get("provider-sync")!;
    const lastFinished = job.lastFinishedAt ? new Date(job.lastFinishedAt).getTime() : this.startedAt;
    return Date.now() - lastFinished >= this.providerSyncIntervalMs;
  }

  private shouldRunTerminalHistoryPurge(): boolean {
    const job = this.jobs.get("terminal-history-purge")!;
    const lastFinished = job.lastFinishedAt ? new Date(job.lastFinishedAt).getTime() : this.startedAt;
    return Date.now() - lastFinished >= this.historyPurgeIntervalMs;
  }

  private markJobStarted(jobId: SchedulerJobId): void {
    const job = this.jobs.get(jobId)!;
    job.isRunning = true;
    job.lastStartedAt = new Date().toISOString();
    this.schedulerJobRepository.upsert({
      id: job.id,
      lastStartedAt: job.lastStartedAt,
      lastFinishedAt: job.lastFinishedAt,
      lastOutcome: job.lastOutcome,
      lastSummary: job.lastSummary
    });
  }

  private markJobFinished(jobId: SchedulerJobId, outcome: SchedulerJobOutcome, summary: string): void {
    const job = this.jobs.get(jobId)!;
    job.isRunning = false;
    job.lastFinishedAt = new Date().toISOString();
    job.lastOutcome = outcome;
    job.lastSummary = summary;
    this.schedulerJobRepository.upsert({
      id: job.id,
      lastStartedAt: job.lastStartedAt,
      lastFinishedAt: job.lastFinishedAt,
      lastOutcome: job.lastOutcome,
      lastSummary: job.lastSummary
    });
  }

  private getNextRunAt(jobId: SchedulerJobId): string | null {
    const job = this.jobs.get(jobId)!;
    const baseTime = job.lastFinishedAt ? new Date(job.lastFinishedAt).getTime() : this.startedAt;
    return new Date(baseTime + job.intervalMs).toISOString();
  }

  private async expireAliases(nowIso: string): Promise<{
    expiredCount: number;
    failedCount: number;
  }> {
    const expiringAliases = this.aliasRepository.listExpiring(nowIso);
    if (expiringAliases.length > 0) {
      log.debug({ count: expiringAliases.length }, "Expiration sweep found aliases due for removal");
    } else {
      log.trace("Expiration sweep found no aliases due");
    }

    let expiredCount = 0;
    let failedCount = 0;

    for (const alias of expiringAliases) {
      try {
        const provider = this.providerRegistry.getProvider(alias.providerName);
        await provider.deleteAlias(alias.providerAliasId);
        this.aliasRepository.updateStatus(alias.id, "expired");
        this.auditLogRepository.create({
          aliasId: alias.id,
          eventType: "alias.expired",
          message: `Alias ${alias.email} expired and was removed from the provider.`
        });
        log.info({ aliasId: alias.id, email: alias.email, provider: alias.providerName }, "Alias expired and removed");
        expiredCount += 1;
      } catch (err) {
        log.error({ aliasId: alias.id, email: alias.email, err }, "Failed to expire alias");
        failedCount += 1;
      }
    }

    return {
      expiredCount,
      failedCount
    };
  }

  private purgeTerminalHistory(now: Date): number {
    const retentionDays = this.settingsService.getSettings().lifecycleSettings.historyRetentionDays;
    const cutoffIso = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const purgeableAliases = this.aliasRepository.listTerminalBefore(cutoffIso);

    for (const alias of purgeableAliases) {
      this.auditLogRepository.deleteForAlias(alias.id);
      this.aliasRepository.delete(alias.id);
      log.info({ aliasId: alias.id, email: alias.email, status: alias.status }, "Purged terminal alias history");
    }

    return purgeableAliases.length;
  }

  private async reconcileProviders(): Promise<{
    providersChecked: number;
    aliasesUpdated: number;
    aliasesMarkedDeleted: number;
    aliasesImported: number;
  }> {
    const aliases = this.aliasRepository.listNonTerminal();
    const aliasesByProvider = new Map<string, Alias[]>();
    for (const alias of aliases) {
      const group = aliasesByProvider.get(alias.providerName) ?? [];
      group.push(alias);
      aliasesByProvider.set(alias.providerName, group);
    }

    const configuredProviders = this.settingsService.getInternalSettings().providerSettings.providers;
    const providerNames = new Set<string>([
      ...aliasesByProvider.keys(),
      ...configuredProviders.map((provider) => provider.type)
    ]);

    if (providerNames.size === 0) {
      return {
        providersChecked: 0,
        aliasesUpdated: 0,
        aliasesMarkedDeleted: 0,
        aliasesImported: 0
      };
    }

    let providersChecked = 0;
    let aliasesUpdated = 0;
    let aliasesMarkedDeleted = 0;
    let aliasesImported = 0;

    for (const providerName of providerNames) {
      const providerAliases = aliasesByProvider.get(providerName) ?? [];
      if (!this.providerRegistry.isImplemented(providerName)) {
        log.warn({ providerName }, "Skipping provider reconciliation because provider is not available");
        continue;
      }

      try {
        const provider = this.providerRegistry.getProvider(providerName);
        if (provider.getConfigurationCapabilities) {
          try {
            const capabilities = await provider.getConfigurationCapabilities();
            if (capabilities) {
              this.settingsService.updateProviderCapabilities(providerName as "addy" | "simplelogin", capabilities);
            }
          } catch (err) {
            log.warn({ providerName, err }, "Provider capability refresh failed; keeping stored configuration metadata");
          }
        }
        const remoteAliases = await provider.listAliases();
        const stats = await this.reconcileProviderState(providerName, providerAliases, remoteAliases);
        providersChecked += 1;
        aliasesUpdated += stats.aliasesUpdated;
        aliasesMarkedDeleted += stats.aliasesMarkedDeleted;
        aliasesImported += stats.aliasesImported;
      } catch (err) {
        log.warn({ providerName, err }, "Provider reconciliation failed; local statuses left unchanged");
      }
    }

    return { providersChecked, aliasesUpdated, aliasesMarkedDeleted, aliasesImported };
  }

  private async reconcileProviderState(providerName: string, localAliases: Alias[], remoteAliases: ProviderAlias[]): Promise<{
    aliasesUpdated: number;
    aliasesMarkedDeleted: number;
    aliasesImported: number;
  }> {
    const remoteById = new Map(remoteAliases.map((alias) => [alias.id, alias]));
    const localByRemoteId = new Map(localAliases.map((alias) => [alias.providerAliasId, alias]));
    let aliasesUpdated = 0;
    let aliasesMarkedDeleted = 0;
    let aliasesImported = 0;

    for (const localAlias of localAliases) {
      const remoteAlias = remoteById.get(localAlias.providerAliasId);
      if (!remoteAlias) {
        this.aliasRepository.updateStatus(localAlias.id, "deleted");
        this.auditLogRepository.create({
          aliasId: localAlias.id,
          eventType: "alias.deleted",
          message: `Alias ${localAlias.email} no longer exists at the provider and was marked deleted.`
        });
        log.info({ aliasId: localAlias.id, email: localAlias.email, provider: localAlias.providerName }, "Alias marked deleted after successful provider sync");
        aliasesMarkedDeleted += 1;
        continue;
      }

      const nextStatus = remoteAlias.enabled ? "active" : "inactive";
      let aliasUpdated = false;

      if (localAlias.status !== nextStatus) {
        this.aliasRepository.updateStatus(localAlias.id, nextStatus);
        this.auditLogRepository.create({
          aliasId: localAlias.id,
          eventType: nextStatus === "active" ? "alias.enabled" : "alias.inactive",
          message: `Alias ${localAlias.email} reconciled to ${nextStatus} from provider state.`
        });
        log.info({ aliasId: localAlias.id, email: localAlias.email, status: nextStatus }, "Alias reconciled from provider state");
        aliasUpdated = true;
      }

      const shouldPushDestination =
        Boolean(localAlias.destinationEmail) && localAlias.destinationEmail !== remoteAlias.destinationEmail;
      const shouldPushLabel = localAlias.label !== remoteAlias.label;

      if (shouldPushDestination || shouldPushLabel) {
        try {
          const provider = this.providerRegistry.getProvider(localAlias.providerName);
          await provider.updateAliasMetadata(localAlias.providerAliasId, {
            note: buildProviderNote(localAlias.label, localAlias.expiresAt),
            destinationEmail: shouldPushDestination ? localAlias.destinationEmail : undefined
          });
          if (shouldPushDestination) {
            this.auditLogRepository.create({
              aliasId: localAlias.id,
              eventType: "alias.destination_pushed",
              message: `Alias forward target pushed to provider: ${localAlias.destinationEmail}.`
            });
            log.info(
              { aliasId: localAlias.id, email: localAlias.email, destinationEmail: localAlias.destinationEmail },
              "Alias forward target pushed to provider state"
            );
          }
          if (shouldPushLabel) {
            this.auditLogRepository.create({
              aliasId: localAlias.id,
              eventType: "alias.label_pushed",
              message: localAlias.label
                ? `Alias label pushed back to provider description: ${localAlias.label}.`
                : "Alias label cleared from provider description."
            });
            log.info({ aliasId: localAlias.id, email: localAlias.email, label: localAlias.label }, "Alias label pushed to provider description");
          }
          this.auditLogRepository.create({
            aliasId: localAlias.id,
            eventType: "alias.metadata_pushed",
            message: "Alias metadata pushed from BurnAlias to provider."
          });
          aliasUpdated = true;
        } catch (err) {
          log.warn({ aliasId: localAlias.id, email: localAlias.email, err }, "Failed to push alias metadata to provider");
        }
      }

      if (aliasUpdated) {
        aliasesUpdated += 1;
      }
    }

    for (const remoteAlias of remoteAliases) {
      if (localByRemoteId.has(remoteAlias.id)) {
        continue;
      }

      const importedAlias: Alias = {
        id: createId(),
        email: remoteAlias.email,
        providerName,
        providerAliasId: remoteAlias.id,
        destinationEmail: remoteAlias.destinationEmail,
        createdAt: remoteAlias.createdAt ?? new Date().toISOString(),
        expiresAt: null,
        status: remoteAlias.enabled ? "active" : "inactive",
        label: remoteAlias.label
      };

      this.aliasRepository.create(importedAlias);
      this.auditLogRepository.create({
        aliasId: importedAlias.id,
        eventType: "alias.imported",
        message: `Alias ${importedAlias.email} was imported from the provider during sync.`
      });
      log.info({ aliasId: importedAlias.id, email: importedAlias.email, provider: importedAlias.providerName }, "Alias imported from provider");
      aliasesImported += 1;
    }

    return { aliasesUpdated, aliasesMarkedDeleted, aliasesImported };
  }
}
