import Database from "better-sqlite3";
import { z } from "zod";
import { ConfiguredProvider, configuredProviderSchema } from "../providers/providerConfig";
import { SupportedProviderDefinition } from "../providers/providerCatalog";
import { createSecretVerificationToken, decryptSecret, encryptSecret } from "../lib/secrets";
import { AliasRepository } from "../repositories/aliasRepository";
import { AuditLogRepository } from "../repositories/auditLogRepository";

export const updateSettingsSchema = z.object({
  providerSettings: z.object({
    providers: z.array(configuredProviderSchema),
    activeProviderId: z.string().trim().min(1).nullable()
  }),
  lifecycleSettings: z.object({
    historyRetentionDays: z.coerce.number().int().min(1).max(3650)
  })
}).superRefine((settings, ctx) => {
  const ids = new Set<string>();

  for (const provider of settings.providerSettings.providers) {
    if (ids.has(provider.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["providerSettings", "providers"],
        message: `Duplicate provider id: ${provider.id}`
      });
      return;
    }

    ids.add(provider.id);
  }

  if (settings.providerSettings.activeProviderId) {
    const activeProvider = settings.providerSettings.providers.find(
      (provider) => provider.id === settings.providerSettings.activeProviderId
    );

    if (!activeProvider) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["providerSettings", "activeProviderId"],
        message: "Active provider must reference a configured provider."
      });
      return;
    }

  }
});

export interface AppSettings {
  auth: {
    username: string | null;
  };
  providerSettings: {
    supportedProviders: SupportedProviderDefinition[];
    providers: ConfiguredProvider[];
    activeProviderId: string | null;
  };
  lifecycleSettings: {
    historyRetentionDays: number;
  };
  securitySettings: {
    sessionTtlMs: number;
  };
}

type SettingsRow = {
  providers_json: string;
  active_provider_id: string | null;
  forward_addresses_json: string;
  history_retention_days: number;
};

export class SettingsService {
  constructor(
    private readonly db: Database.Database,
    private readonly username: string | null,
    private readonly sessionTtlMs: number,
    private readonly supportedProviders: SupportedProviderDefinition[],
    private readonly aliasRepository: AliasRepository,
    private readonly auditLogRepository: AuditLogRepository
  ) {}

  getSettings(): AppSettings {
    const internalSettings = this.getInternalSettings();
    return {
      ...internalSettings,
      providerSettings: {
        ...internalSettings.providerSettings,
        providers: internalSettings.providerSettings.providers.map((provider) =>
          provider.type === "simplelogin"
            ? {
                ...provider,
                config: {
                  apiKey: "",
                  hasStoredSecret: Boolean(provider.config.apiKey),
                  clearStoredSecret: false,
                  lastConnectionTestSucceededAt: provider.config.lastConnectionTestSucceededAt ?? null,
                  lastConnectionTestVerificationToken: null
                }
              }
            : provider
        )
      }
    };
  }

  getInternalSettings(): AppSettings {
    const row = this.db
      .prepare(`
        SELECT providers_json, active_provider_id, forward_addresses_json
             , history_retention_days
        FROM app_settings
        WHERE id = 1
      `)
      .get() as SettingsRow;
    const providers = this.parseProviders(row.providers_json);

    return {
      auth: {
        username: this.username
      },
      providerSettings: {
        supportedProviders: this.supportedProviders,
        providers,
        activeProviderId: row.active_provider_id
      },
      lifecycleSettings: {
        historyRetentionDays: row.history_retention_days
      },
      securitySettings: {
        sessionTtlMs: this.sessionTtlMs
      }
    };
  }

  getActiveProvider(): ConfiguredProvider | null {
    const settings = this.getInternalSettings();
    if (!settings.providerSettings.activeProviderId) {
      return null;
    }

    return (
      settings.providerSettings.providers.find(
        (provider) => provider.id === settings.providerSettings.activeProviderId
      ) ?? null
    );
  }

  updateSettings(input: z.infer<typeof updateSettingsSchema>): AppSettings {
    const existingProviders = this.getInternalSettings().providerSettings.providers;
    const removedProviderCount =
      existingProviders.length - input.providerSettings.providers.length;
    const nextProvidersById = new Map(input.providerSettings.providers.map((provider) => [provider.id, provider]));
    const removedProviders = existingProviders.filter((provider) => !nextProvidersById.has(provider.id));

    for (const existingProvider of existingProviders) {
      if (nextProvidersById.has(existingProvider.id)) {
        continue;
      }

      if (this.aliasRepository.countNonTerminalByProviderName(existingProvider.type) > 0) {
        throw new Error(`Cannot remove ${existingProvider.name} while active or inactive aliases are still tied to it.`);
      }
    }

    if (removedProviderCount > 0 && input.providerSettings.providers.length > 0 && !input.providerSettings.activeProviderId) {
      throw new Error("Set another ready provider active before removing a provider.");
    }

    const normalizedProviders = input.providerSettings.providers.map((provider) => {
      if (provider.type === "simplelogin") {
        const existingProvider = existingProviders.find(
          (item) => item.id === provider.id && item.type === "simplelogin"
        );
        const shouldClearSecret = provider.config.clearStoredSecret ?? false;
        const typedApiKey = provider.config.apiKey.trim();
        const existingApiKey =
          existingProvider?.type === "simplelogin" ? existingProvider.config.apiKey : "";
        const nextApiKey = shouldClearSecret
          ? ""
          : typedApiKey
            ? typedApiKey
            : existingApiKey;
        const hasNewTypedApiKey = Boolean(typedApiKey);
        const existingLastSuccessfulTest =
          existingProvider?.type === "simplelogin"
            ? (existingProvider.config.lastConnectionTestSucceededAt ?? null)
            : null;
        const existingVerificationToken =
          existingProvider?.type === "simplelogin"
            ? (existingProvider.config.lastConnectionTestVerificationToken ?? null)
            : null;
        const providedVerificationToken = provider.config.lastConnectionTestVerificationToken ?? null;
        const hasVerifiedReplacementKey =
          hasNewTypedApiKey &&
          Boolean(provider.config.lastConnectionTestSucceededAt) &&
          Boolean(providedVerificationToken) &&
          providedVerificationToken === createSecretVerificationToken(typedApiKey);
        const lastConnectionTestSucceededAt = shouldClearSecret
          ? null
          : hasVerifiedReplacementKey
            ? (provider.config.lastConnectionTestSucceededAt ?? null)
            : hasNewTypedApiKey
              ? null
              : existingLastSuccessfulTest;
        const lastConnectionTestVerificationToken = shouldClearSecret
          ? null
          : hasVerifiedReplacementKey
            ? providedVerificationToken
            : hasNewTypedApiKey
              ? null
              : existingVerificationToken;

        return {
          ...provider,
          config: {
            apiKey: nextApiKey ? encryptSecret(nextApiKey) : "",
            hasStoredSecret: Boolean(nextApiKey),
            clearStoredSecret: false,
            lastConnectionTestSucceededAt,
            lastConnectionTestVerificationToken
          }
        };
      }

      return provider;
    });

    if (input.providerSettings.activeProviderId) {
      const activeProvider = normalizedProviders.find(
        (provider) => provider.id === input.providerSettings.activeProviderId
      );

      if (!activeProvider) {
        throw new Error("Active provider must reference a configured provider.");
      }

      if (!this.isProviderReady(activeProvider)) {
        throw new Error(`The active provider "${activeProvider.name}" is not ready yet.`);
      }
    }

    const providerRemovalAuditEntries = removedProviders.flatMap((provider) =>
      this.aliasRepository.listTerminalByProviderName(provider.type).map((alias) => ({
        aliasId: alias.id,
        eventType: "provider.removed",
        message: `Provider ${provider.name} (${provider.type}) was removed from BurnAlias. This alias remains for historical reference only.`
      }))
    );

    this.db
      .prepare(`
        UPDATE app_settings
        SET providers_json = ?,
            active_provider_id = ?,
            history_retention_days = ?,
            updated_at = ?
        WHERE id = 1
      `)
      .run(
        JSON.stringify(normalizedProviders),
        input.providerSettings.activeProviderId,
        input.lifecycleSettings.historyRetentionDays,
        new Date().toISOString()
      );

    for (const entry of providerRemovalAuditEntries) {
      this.auditLogRepository.create(entry);
    }

    return this.getSettings();
  }

  private parseProviders(rawProvidersJson: string): ConfiguredProvider[] {
    const parsed = z.array(configuredProviderSchema).safeParse(JSON.parse(rawProvidersJson));
    if (!parsed.success) {
      throw new Error("Stored provider configuration is invalid.");
    }

    return parsed.data.map((provider) => {
      if (provider.type !== "simplelogin") {
        return provider;
      }

      const decryptedApiKey = provider.config.apiKey ? decryptSecret(provider.config.apiKey) : "";
      return {
        ...provider,
        config: {
          apiKey: decryptedApiKey,
          hasStoredSecret: Boolean(decryptedApiKey),
          clearStoredSecret: false,
          lastConnectionTestSucceededAt: provider.config.lastConnectionTestSucceededAt ?? null,
          lastConnectionTestVerificationToken: provider.config.lastConnectionTestVerificationToken ?? null
        }
      };
    });
  }

  private isProviderReady(provider: ConfiguredProvider): boolean {
    if (provider.type === "simplelogin") {
      const providerApiKey = decryptSecret(provider.config.apiKey);
      const hasSecret = Boolean(providerApiKey);
      const hasSuccessfulTest = Boolean(provider.config.lastConnectionTestSucceededAt);
      const hasMatchingVerificationToken =
        Boolean(provider.config.lastConnectionTestVerificationToken) &&
        provider.config.lastConnectionTestVerificationToken ===
          createSecretVerificationToken(providerApiKey);
      return hasSecret && hasSuccessfulTest && hasMatchingVerificationToken;
    }

    return false;
  }
}
