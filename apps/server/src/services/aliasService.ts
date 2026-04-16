import { z } from "zod";
import { Alias, AliasStatus } from "../domain/alias";
import { createId } from "../lib/id";
import { logger } from "../lib/logger";
import { ProviderRegistry } from "../providers/providerRegistry";
import { AliasRepository } from "../repositories/aliasRepository";
import { AuditLogRepository } from "../repositories/auditLogRepository";
import { SettingsService } from "./settingsService";

const log = logger.child({ module: "aliasService" });

export const createAliasSchema = z.object({
  localPart: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9._+-]+$/, "localPart contains unsupported characters"),
  destinationEmail: z.string().email(),
  expiresInHours: z.coerce.number().int().min(1).max(87600).nullable().optional(),
  label: z.string().max(64).nullable().optional(),
  providerHint: z.string().min(1).nullable().optional()
});

function buildProviderNote(label: string | null | undefined, expiresAt: string | null): string | null {
  const parts: string[] = [];

  if (label) {
    parts.push(`Label: ${label}`);
  }

  if (expiresAt) {
    parts.push(`BurnAlias expiration: ${expiresAt}`);
  }

  return parts.length > 0 ? parts.join(" | ") : null;
}

export class AliasService {
  constructor(
    private readonly aliasRepository: AliasRepository,
    private readonly auditLogRepository: AuditLogRepository,
    private readonly providerRegistry: ProviderRegistry,
    private readonly settingsService: SettingsService
  ) {}

  listAliases(status?: AliasStatus): Alias[] {
    return this.aliasRepository.list(status);
  }

  async createAlias(input: z.infer<typeof createAliasSchema>): Promise<Alias> {
    const activeProvider = this.settingsService.getActiveProvider();
    if (!activeProvider) {
      log.warn("Alias creation failed: no active provider configured");
      throw new Error("No active provider is configured.");
    }

    if (!this.providerRegistry.isImplemented(activeProvider.type)) {
      log.warn({ providerType: activeProvider.type, providerName: activeProvider.name }, "Alias creation failed: provider not implemented");
      throw new Error(`The active provider "${activeProvider.name}" is not available yet.`);
    }

    const provider = this.providerRegistry.getProvider(activeProvider.type);
    log.debug({ localPart: input.localPart, destination: input.destinationEmail, provider: provider.name }, "Creating alias via provider");

    const createdAt = new Date();
    const expiresAt =
      input.expiresInHours != null
        ? new Date(createdAt.getTime() + input.expiresInHours * 60 * 60 * 1000).toISOString()
        : null;
    const providerNote = buildProviderNote(input.label ?? null, expiresAt);

    const providerAlias = await provider.createAlias({
      localPart: input.localPart,
      destinationEmail: input.destinationEmail,
      note: providerNote,
      providerHint: input.providerHint ?? null
    });

    const alias: Alias = {
      id: createId(),
      email: providerAlias.email,
      providerName: provider.name,
      providerAliasId: providerAlias.id,
      destinationEmail: input.destinationEmail,
      createdAt: createdAt.toISOString(),
      expiresAt,
      status: "active",
      label: input.label ?? null
    };

    this.aliasRepository.create(alias);
    this.auditLogRepository.create({
      aliasId: alias.id,
      eventType: "alias.created",
      message: `Alias ${alias.email} created through ${alias.providerName}.`
    });

    log.info({ aliasId: alias.id, email: alias.email, provider: alias.providerName, expiresAt }, "Alias created");
    return alias;
  }

  async setAliasStatus(id: string, nextStatus: Extract<AliasStatus, "active" | "inactive">): Promise<Alias> {
    const alias = this.aliasRepository.findById(id);
    if (!alias) {
      log.warn({ aliasId: id }, "Status change failed: alias not found");
      throw new Error("Alias not found");
    }

    log.debug({ aliasId: alias.id, email: alias.email, from: alias.status, to: nextStatus }, "Changing alias status");

    const provider = this.providerRegistry.getProvider(alias.providerName);
    if (alias.status === "expired" || alias.status === "deleted") {
      throw new Error("Terminal aliases cannot be reactivated.");
    }

    if (nextStatus === "active") {
      await provider.enableAlias(alias.providerAliasId);
    } else {
      await provider.disableAlias(alias.providerAliasId);
    }

    this.aliasRepository.updateStatus(id, nextStatus);
    this.auditLogRepository.create({
      aliasId: alias.id,
      eventType: nextStatus === "active" ? "alias.enabled" : "alias.inactive",
      message: `Alias ${alias.email} manually set to ${nextStatus}.`
    });

    log.info({ aliasId: alias.id, email: alias.email, status: nextStatus }, "Alias status updated");
    return { ...alias, status: nextStatus };
  }

  async deleteAlias(id: string): Promise<void> {
    const alias = this.aliasRepository.findById(id);
    if (!alias) {
      log.warn({ aliasId: id }, "Delete failed: alias not found");
      throw new Error("Alias not found");
    }

    log.debug({ aliasId: alias.id, email: alias.email, provider: alias.providerName }, "Deleting alias");

    const provider = this.providerRegistry.getProvider(alias.providerName);
    await provider.deleteAlias(alias.providerAliasId);
    this.auditLogRepository.create({
      aliasId: alias.id,
      eventType: "alias.deleted",
      message: `Alias ${alias.email} deleted and removed from the provider.`
    });
    this.aliasRepository.updateStatus(id, "deleted");

    log.info({ aliasId: alias.id, email: alias.email }, "Alias deleted");
  }

  async updateExpiration(id: string, expiresInHours: number | null): Promise<Alias> {
    const alias = this.aliasRepository.findById(id);
    if (!alias) {
      log.warn({ aliasId: id }, "Expiration update failed: alias not found");
      throw new Error("Alias not found");
    }
    if (alias.status === "expired" || alias.status === "deleted") {
      throw new Error("Cannot update expiration on a terminal alias.");
    }
    const expiresAt =
      expiresInHours != null
        ? new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString()
        : null;
    this.aliasRepository.updateExpiration(id, expiresAt);
    this.auditLogRepository.create({
      aliasId: alias.id,
      eventType: "alias.expiration_updated",
      message: expiresAt ? `Expiration set to ${expiresAt}.` : "Expiration cleared."
    });
    log.info({ aliasId: alias.id, email: alias.email, expiresAt }, "Alias expiration updated");
    return { ...alias, expiresAt };
  }

  listAuditLog(aliasId: string) {
    return this.auditLogRepository.listForAlias(aliasId);
  }
}
