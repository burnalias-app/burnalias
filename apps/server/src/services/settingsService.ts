import Database from "better-sqlite3";
import { z } from "zod";
import { ConfiguredProvider, configuredProviderSchema } from "../providers/providerConfig";
import { SupportedProviderDefinition } from "../providers/providerCatalog";

export const updateSettingsSchema = z.object({
  providerSettings: z.object({
    providers: z.array(configuredProviderSchema),
    activeProviderId: z.string().trim().min(1).nullable()
  }),
  uiSettings: z.object({
    forwardAddresses: z.array(z.string().email()).min(1)
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

    if (!activeProvider.enabled) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["providerSettings", "activeProviderId"],
        message: "Active provider must be enabled."
      });
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
  uiSettings: {
    forwardAddresses: string[];
  };
  securitySettings: {
    sessionTtlMs: number;
  };
}

type SettingsRow = {
  providers_json: string;
  active_provider_id: string | null;
  forward_addresses_json: string;
};

export class SettingsService {
  constructor(
    private readonly db: Database.Database,
    private readonly username: string | null,
    private readonly sessionTtlMs: number,
    private readonly supportedProviders: SupportedProviderDefinition[]
  ) {}

  getSettings(): AppSettings {
    const row = this.db
      .prepare(`
        SELECT providers_json, active_provider_id, forward_addresses_json
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
      uiSettings: {
        forwardAddresses: JSON.parse(row.forward_addresses_json) as string[]
      },
      securitySettings: {
        sessionTtlMs: this.sessionTtlMs
      }
    };
  }

  getActiveProvider(): ConfiguredProvider | null {
    const settings = this.getSettings();
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
    const normalizedProviders = input.providerSettings.providers.map((provider) => {
      if (provider.type !== "mock") {
        return provider;
      }

      return {
        ...provider,
        config: {
          aliasDomain: provider.config.aliasDomain.toLowerCase()
        }
      };
    });

    this.db
      .prepare(`
        UPDATE app_settings
        SET providers_json = ?,
            active_provider_id = ?,
            forward_addresses_json = ?,
            updated_at = ?
        WHERE id = 1
      `)
      .run(
        JSON.stringify(normalizedProviders),
        input.providerSettings.activeProviderId,
        JSON.stringify(input.uiSettings.forwardAddresses),
        new Date().toISOString()
      );

    return this.getSettings();
  }

  private parseProviders(rawProvidersJson: string): ConfiguredProvider[] {
    const parsed = z.array(configuredProviderSchema).safeParse(JSON.parse(rawProvidersJson));
    if (!parsed.success) {
      throw new Error("Stored provider configuration is invalid.");
    }

    return parsed.data;
  }
}
