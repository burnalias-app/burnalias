import { logger } from "../lib/logger";
import { ConfiguredProvider } from "./providerConfig";
import { MockAliasProvider } from "./mockProvider";
import { SimpleLoginProvider } from "./simpleLoginProvider";
import { AliasProvider, ConnectionTestResult } from "./provider";
import { SupportedProviderDefinition, supportedProviders, ProviderType } from "./providerCatalog";

const log = logger.child({ module: "providerRegistry" });

export class ProviderRegistry {
  private readonly providers = new Map<ProviderType, AliasProvider>();

  constructor() {
    this.providers.set("mock", new MockAliasProvider());
  }

  /**
   * Rebuild real-provider entries from persisted settings.
   * Call on startup and after every settings save.
   */
  reconfigure(configuredProviders: ConfiguredProvider[]): void {
    // Clear all non-mock providers before rebuilding
    for (const type of ["simplelogin", "addy", "cloudflare"] as ProviderType[]) {
      this.providers.delete(type);
    }

    for (const config of configuredProviders) {
      if (!config.enabled) continue;

      if (config.type === "simplelogin" && config.config.apiKey) {
        this.providers.set("simplelogin", new SimpleLoginProvider(config.config.apiKey));
        log.info({ provider: "simplelogin" }, "Provider registered");
      }
    }
  }

  /**
   * Test a provider connection using raw config from the request.
   * Creates a temporary instance — does not require the provider to be registered.
   */
  async testConnection(type: ProviderType, config: Record<string, string>): Promise<ConnectionTestResult> {
    switch (type) {
      case "mock":
        return { success: true, message: "Mock provider — no external connection needed." };

      case "simplelogin": {
        if (!config.apiKey) {
          return { success: false, message: "API key is required." };
        }
        const provider = new SimpleLoginProvider(config.apiKey);
        return provider.testConnection();
      }

      default:
        return { success: false, message: `Connection testing is not yet available for ${type}.` };
    }
  }

  async getAliasSuffix(type: ProviderType): Promise<string | null> {
    if (type === "simplelogin") {
      const provider = this.providers.get("simplelogin") as SimpleLoginProvider | undefined;
      return (await provider?.getFirstSuffix()) ?? null;
    }
    return null;
  }

  getProvider(type: string): AliasProvider {
    const provider = this.providers.get(type as ProviderType);
    if (!provider) {
      throw new Error(`Provider not available: ${type}`);
    }
    return provider;
  }

  isImplemented(type: string): boolean {
    return this.providers.has(type as ProviderType);
  }

  listSupportedProviders(): SupportedProviderDefinition[] {
    return supportedProviders;
  }

  listProviders(): ProviderType[] {
    return supportedProviders.map((p) => p.type);
  }
}
