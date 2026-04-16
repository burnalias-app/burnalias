import { Alias, ProviderAlias } from "../domain/alias";
import { logger } from "../lib/logger";
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
          description: "Reconciles BurnAlias alias state against the active providers.",
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
      "Lifecycle scheduler started"
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
      log.info("Lifecycle scheduler stopped");
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
      log.info({ expirationCount, purgedCount }, "Lifecycle run complete");
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
            : `Checked ${stats.providersChecked} provider${stats.providersChecked === 1 ? "" : "s"}, updated ${stats.aliasesUpdated} aliases, and marked ${stats.aliasesMarkedDeleted} deleted.`;
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
            ? `Expired ${expiredCount} aliases. ${failedCount} expiration attempt${failedCount === 1 ? "" : "s"} failed.`
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
      log.debug({ count: expiringAliases.length }, "Expiration check tick");
    } else {
      log.trace("Expiration check tick");
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
  }> {
    const aliases = this.aliasRepository.listNonTerminal();
    if (aliases.length === 0) {
      return {
        providersChecked: 0,
        aliasesUpdated: 0,
        aliasesMarkedDeleted: 0
      };
    }

    const aliasesByProvider = new Map<string, Alias[]>();
    for (const alias of aliases) {
      const group = aliasesByProvider.get(alias.providerName) ?? [];
      group.push(alias);
      aliasesByProvider.set(alias.providerName, group);
    }

    let providersChecked = 0;
    let aliasesUpdated = 0;
    let aliasesMarkedDeleted = 0;

    for (const [providerName, providerAliases] of aliasesByProvider.entries()) {
      if (!this.providerRegistry.isImplemented(providerName)) {
        log.warn({ providerName }, "Skipping provider reconciliation because provider is not available");
        continue;
      }

      try {
        const provider = this.providerRegistry.getProvider(providerName);
        const remoteAliases = await provider.listAliases();
        const stats = this.reconcileProviderState(providerAliases, remoteAliases);
        providersChecked += 1;
        aliasesUpdated += stats.aliasesUpdated;
        aliasesMarkedDeleted += stats.aliasesMarkedDeleted;
      } catch (err) {
        log.warn({ providerName, err }, "Provider reconciliation failed; local statuses left unchanged");
      }
    }

    return { providersChecked, aliasesUpdated, aliasesMarkedDeleted };
  }

  private reconcileProviderState(localAliases: Alias[], remoteAliases: ProviderAlias[]): {
    aliasesUpdated: number;
    aliasesMarkedDeleted: number;
  } {
    const remoteById = new Map(remoteAliases.map((alias) => [alias.id, alias]));
    let aliasesUpdated = 0;
    let aliasesMarkedDeleted = 0;

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
      if (localAlias.status !== nextStatus) {
        this.aliasRepository.updateStatus(localAlias.id, nextStatus);
        this.auditLogRepository.create({
          aliasId: localAlias.id,
          eventType: nextStatus === "active" ? "alias.enabled" : "alias.inactive",
          message: `Alias ${localAlias.email} reconciled to ${nextStatus} from provider state.`
        });
        log.info({ aliasId: localAlias.id, email: localAlias.email, status: nextStatus }, "Alias reconciled from provider state");
        aliasesUpdated += 1;
      }
    }

    return { aliasesUpdated, aliasesMarkedDeleted };
  }
}
