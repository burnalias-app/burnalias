import Database from "better-sqlite3";
import { z } from "zod";
import { ConfiguredProvider, configuredProviderSchema } from "../providers/providerConfig";
import { ProviderType, SupportedProviderDefinition } from "../providers/providerCatalog";
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
        message: "Default provider must reference a configured provider."
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
    providerAliasCounts: Record<string, number>;
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
        providers: internalSettings.providerSettings.providers.map((provider) => this.maskProvider(provider))
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
        activeProviderId: row.active_provider_id,
        providerAliasCounts: this.buildProviderAliasCounts()
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

  getProviderByType(type: ProviderType): ConfiguredProvider | null {
    const settings = this.getInternalSettings();
    return settings.providerSettings.providers.find((provider) => provider.type === type) ?? null;
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
      throw new Error("Set another ready default provider before removing a provider.");
    }

    const normalizedProviders = input.providerSettings.providers.map((provider) => {
      if (provider.type === "simplelogin") {
        return this.normalizeSimpleLoginProvider(provider, existingProviders);
      }

      if (provider.type === "addy") {
        return this.normalizeAddyProvider(provider, existingProviders);
      }

      return provider;
    });

    if (input.providerSettings.activeProviderId) {
      const activeProvider = normalizedProviders.find(
        (provider) => provider.id === input.providerSettings.activeProviderId
      );

      if (!activeProvider) {
        throw new Error("Default provider must reference a configured provider.");
      }

      if (!this.isProviderReady(activeProvider)) {
        throw new Error(`The default provider "${activeProvider.name}" is not ready yet.`);
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
      if (provider.type === "simplelogin") {
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
      }

      if (provider.type === "addy") {
        const decryptedApiKey = provider.config.apiKey ? decryptSecret(provider.config.apiKey) : "";
        return {
          ...provider,
          config: {
            apiKey: decryptedApiKey,
            hasStoredSecret: Boolean(decryptedApiKey),
            clearStoredSecret: false,
            lastConnectionTestSucceededAt: provider.config.lastConnectionTestSucceededAt ?? null,
            lastConnectionTestVerificationToken: provider.config.lastConnectionTestVerificationToken ?? null,
            supportsCustomAliases: provider.config.supportsCustomAliases ?? null,
            defaultAliasDomain: provider.config.defaultAliasDomain ?? null,
            defaultAliasFormat: provider.config.defaultAliasFormat ?? null,
            domainOptions: provider.config.domainOptions ?? [],
            maxRecipientCount: provider.config.maxRecipientCount ?? null
          }
        };
      }

      return provider;
    });
  }

  private isProviderReady(provider: ConfiguredProvider): boolean {
    if (provider.type === "simplelogin") {
      return this.hasVerifiedProviderSecret(provider, decryptSecret(provider.config.apiKey));
    }

    if (provider.type === "addy") {
      return this.hasVerifiedProviderSecret(provider, decryptSecret(provider.config.apiKey));
    }

    return false;
  }

  private buildProviderAliasCounts(): Record<string, number> {
    return Object.fromEntries(
      this.supportedProviders.map((provider) => [
        provider.type,
        this.aliasRepository.countNonTerminalByProviderName(provider.type)
      ])
    );
  }

  private maskProvider(provider: ConfiguredProvider): ConfiguredProvider {
    if (provider.type === "simplelogin") {
      return {
        ...provider,
        config: {
          apiKey: "",
          hasStoredSecret: Boolean(provider.config.apiKey),
          clearStoredSecret: false,
          lastConnectionTestSucceededAt: provider.config.lastConnectionTestSucceededAt ?? null,
          lastConnectionTestVerificationToken: null
        }
      };
    }

    if (provider.type === "addy") {
      return {
        ...provider,
        config: {
          apiKey: "",
          hasStoredSecret: Boolean(provider.config.apiKey),
          clearStoredSecret: false,
          lastConnectionTestSucceededAt: provider.config.lastConnectionTestSucceededAt ?? null,
          lastConnectionTestVerificationToken: null,
          supportsCustomAliases: provider.config.supportsCustomAliases ?? null,
          defaultAliasDomain: provider.config.defaultAliasDomain ?? null,
          defaultAliasFormat: provider.config.defaultAliasFormat ?? null,
          domainOptions: provider.config.domainOptions ?? [],
          maxRecipientCount: provider.config.maxRecipientCount ?? null
        }
      };
    }

    return provider;
  }

  private normalizeSimpleLoginProvider(
    provider: Extract<ConfiguredProvider, { type: "simplelogin" }>,
    existingProviders: ConfiguredProvider[]
  ): Extract<ConfiguredProvider, { type: "simplelogin" }> {
    const existingProvider = existingProviders.find(
      (item) => item.id === provider.id && item.type === "simplelogin"
    );
    const shouldClearSecret = provider.config.clearStoredSecret ?? false;
    const typedApiKey = provider.config.apiKey.trim();
    const existingApiKey = existingProvider?.type === "simplelogin" ? existingProvider.config.apiKey : "";
    const nextApiKey = shouldClearSecret ? "" : typedApiKey || existingApiKey;
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
    const verificationMaterial = typedApiKey;
    const hasVerifiedReplacementKey =
      hasNewTypedApiKey &&
      Boolean(provider.config.lastConnectionTestSucceededAt) &&
      Boolean(providedVerificationToken) &&
      providedVerificationToken === createSecretVerificationToken(verificationMaterial);

    return {
      ...provider,
      config: {
        apiKey: nextApiKey ? encryptSecret(nextApiKey) : "",
        hasStoredSecret: Boolean(nextApiKey),
        clearStoredSecret: false,
        lastConnectionTestSucceededAt: shouldClearSecret
          ? null
          : hasVerifiedReplacementKey
            ? (provider.config.lastConnectionTestSucceededAt ?? null)
            : hasNewTypedApiKey
              ? null
              : existingLastSuccessfulTest,
        lastConnectionTestVerificationToken: shouldClearSecret
          ? null
          : hasVerifiedReplacementKey
            ? providedVerificationToken
            : hasNewTypedApiKey
              ? null
              : existingVerificationToken
      }
    };
  }

  private normalizeAddyProvider(
    provider: Extract<ConfiguredProvider, { type: "addy" }>,
    existingProviders: ConfiguredProvider[]
  ): Extract<ConfiguredProvider, { type: "addy" }> {
    const existingProvider = existingProviders.find(
      (item) => item.id === provider.id && item.type === "addy"
    );
    const shouldClearSecret = provider.config.clearStoredSecret ?? false;
    const typedApiKey = provider.config.apiKey.trim();
    const existingApiKey = existingProvider?.type === "addy" ? existingProvider.config.apiKey : "";
    const nextApiKey = shouldClearSecret ? "" : typedApiKey || existingApiKey;
    const hasNewTypedApiKey = Boolean(typedApiKey);
    const existingLastSuccessfulTest =
      existingProvider?.type === "addy"
        ? (existingProvider.config.lastConnectionTestSucceededAt ?? null)
        : null;
    const existingVerificationToken =
      existingProvider?.type === "addy"
        ? (existingProvider.config.lastConnectionTestVerificationToken ?? null)
        : null;
    const existingSupportsCustomAliases =
      existingProvider?.type === "addy" ? (existingProvider.config.supportsCustomAliases ?? null) : null;
    const existingDefaultAliasDomain =
      existingProvider?.type === "addy" ? (existingProvider.config.defaultAliasDomain ?? null) : null;
    const existingDefaultAliasFormat =
      existingProvider?.type === "addy" ? (existingProvider.config.defaultAliasFormat ?? null) : null;
    const existingDomainOptions =
      existingProvider?.type === "addy" ? (existingProvider.config.domainOptions ?? []) : [];
    const existingMaxRecipientCount =
      existingProvider?.type === "addy" ? (existingProvider.config.maxRecipientCount ?? null) : null;
    const providedVerificationToken = provider.config.lastConnectionTestVerificationToken ?? null;
    const hasVerifiedReplacementKey =
      hasNewTypedApiKey &&
      Boolean(provider.config.lastConnectionTestSucceededAt) &&
      Boolean(providedVerificationToken) &&
      providedVerificationToken === createSecretVerificationToken(typedApiKey);

    return {
      ...provider,
      config: {
        apiKey: nextApiKey ? encryptSecret(nextApiKey) : "",
        hasStoredSecret: Boolean(nextApiKey),
        clearStoredSecret: false,
        lastConnectionTestSucceededAt: shouldClearSecret
          ? null
          : hasVerifiedReplacementKey
            ? (provider.config.lastConnectionTestSucceededAt ?? null)
            : hasNewTypedApiKey
              ? null
              : existingLastSuccessfulTest,
        lastConnectionTestVerificationToken: shouldClearSecret
          ? null
          : hasVerifiedReplacementKey
            ? providedVerificationToken
            : hasNewTypedApiKey
              ? null
              : existingVerificationToken,
        supportsCustomAliases: shouldClearSecret
          ? null
          : hasVerifiedReplacementKey
            ? (provider.config.supportsCustomAliases ?? null)
            : hasNewTypedApiKey
              ? null
              : existingSupportsCustomAliases,
        defaultAliasDomain: shouldClearSecret
          ? null
          : hasVerifiedReplacementKey
            ? (provider.config.defaultAliasDomain ?? null)
            : hasNewTypedApiKey
              ? null
              : existingDefaultAliasDomain,
        defaultAliasFormat: shouldClearSecret
          ? null
          : hasVerifiedReplacementKey
            ? (provider.config.defaultAliasFormat ?? null)
            : hasNewTypedApiKey
              ? null
              : existingDefaultAliasFormat,
        domainOptions: shouldClearSecret
          ? []
          : hasVerifiedReplacementKey
            ? (provider.config.domainOptions ?? [])
            : hasNewTypedApiKey
              ? []
              : existingDomainOptions,
        maxRecipientCount: shouldClearSecret
          ? null
          : hasVerifiedReplacementKey
            ? (provider.config.maxRecipientCount ?? null)
            : hasNewTypedApiKey
              ? null
              : existingMaxRecipientCount
      }
    };
  }

  updateProviderCapabilities(type: ProviderType, capabilities: {
    supportsCustomAliases?: boolean;
    defaultAliasDomain?: string | null;
    defaultAliasFormat?: string | null;
    domainOptions?: string[];
    maxRecipientCount?: number | null;
  }): void {
    if (type !== "addy") {
      return;
    }

    const settings = this.getInternalSettings();
    const nextProviders = settings.providerSettings.providers.map((provider) => {
      if (provider.type !== "addy") {
        return provider;
      }

      return {
        ...provider,
        config: {
          ...provider.config,
          supportsCustomAliases: capabilities.supportsCustomAliases ?? provider.config.supportsCustomAliases ?? null,
          defaultAliasDomain: capabilities.defaultAliasDomain ?? provider.config.defaultAliasDomain ?? null,
          defaultAliasFormat: capabilities.defaultAliasFormat ?? provider.config.defaultAliasFormat ?? null,
          domainOptions: capabilities.domainOptions ?? provider.config.domainOptions ?? [],
          maxRecipientCount: capabilities.maxRecipientCount ?? provider.config.maxRecipientCount ?? null
        }
      };
    });

    this.db
      .prepare(`
        UPDATE app_settings
        SET providers_json = ?,
            updated_at = ?
        WHERE id = 1
      `)
      .run(JSON.stringify(nextProviders), new Date().toISOString());
  }

  private hasVerifiedProviderSecret(provider: ConfiguredProvider, verificationMaterial: string): boolean {
    const hasSecret = Boolean(verificationMaterial);
    const hasSuccessfulTest = Boolean(provider.config.lastConnectionTestSucceededAt);
    const hasMatchingVerificationToken =
      Boolean(provider.config.lastConnectionTestVerificationToken) &&
      provider.config.lastConnectionTestVerificationToken ===
        createSecretVerificationToken(verificationMaterial);
    return hasSecret && hasSuccessfulTest && hasMatchingVerificationToken;
  }

}
