import { logger } from "../lib/logger";
import { ProviderRegistry } from "../providers/providerRegistry";
import { AliasRepository } from "../repositories/aliasRepository";
import { AuditLogRepository } from "../repositories/auditLogRepository";

const log = logger.child({ module: "expirationScheduler" });

export class ExpirationScheduler {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly aliasRepository: AliasRepository,
    private readonly auditLogRepository: AuditLogRepository,
    private readonly providerRegistry: ProviderRegistry,
    private readonly intervalMs: number
  ) {}

  start(): void {
    log.info({ intervalMs: this.intervalMs }, "Expiration scheduler started");
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.intervalMs);

    void this.runOnce();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      log.info("Expiration scheduler stopped");
    }
  }

  async runOnce(): Promise<number> {
    const nowIso = new Date().toISOString();
    const expiredAliases = this.aliasRepository.listExpiredActive(nowIso);

    log.debug({ count: expiredAliases.length }, "Expiration check tick");

    for (const alias of expiredAliases) {
      try {
        const provider = this.providerRegistry.getProvider(alias.providerName);
        await provider.disableAlias(alias.providerAliasId);
        this.aliasRepository.updateStatus(alias.id, "expired");
        this.auditLogRepository.create({
          aliasId: alias.id,
          eventType: "alias.expired",
          message: `Alias ${alias.email} expired and was automatically disabled.`
        });
        log.info({ aliasId: alias.id, email: alias.email, provider: alias.providerName }, "Alias expired and disabled");
      } catch (err) {
        log.error({ aliasId: alias.id, email: alias.email, err }, "Failed to expire alias");
      }
    }

    if (expiredAliases.length > 0) {
      log.info({ count: expiredAliases.length }, "Expiration run complete");
    }

    return expiredAliases.length;
  }
}
