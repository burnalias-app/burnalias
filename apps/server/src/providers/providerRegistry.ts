import { logger } from "../lib/logger";
import { ConfiguredProvider } from "./providerConfig";
import { AddyProvider } from "./addyProvider";
import { SimpleLoginProvider } from "./simpleLoginProvider";
import { AliasPreviewResult, AliasProvider, ConnectionTestResult, ForwardTarget } from "./provider";
import { SupportedProviderDefinition, supportedProviders, ProviderType } from "./providerCatalog";

const log = logger.child({ module: "providerRegistry" });

export class ProviderRegistry {
  private readonly providers = new Map<ProviderType, AliasProvider>();

  /**
   * Rebuild provider entries from persisted settings.
   * Call on startup and after every settings save.
   */
  reconfigure(configuredProviders: ConfiguredProvider[]): void {
    this.providers.clear();

    for (const config of configuredProviders) {
      switch (config.type) {
        case "simplelogin":
          if (config.config.apiKey) {
            this.providers.set("simplelogin", new SimpleLoginProvider(config.config.apiKey));
            log.info({ provider: "simplelogin" }, "Provider registered");
          }
          break;
        case "addy":
          if (config.config.apiKey) {
            this.providers.set("addy", new AddyProvider(config.config.apiKey));
            log.info({ provider: "addy" }, "Provider registered");
          }
          break;
      }
    }
  }

  /**
   * Test a provider connection using raw config from the request.
   * Creates a temporary instance — does not require the provider to be registered.
   */
  async testConnection(type: ProviderType, config: Record<string, string>): Promise<ConnectionTestResult> {
    switch (type) {
      case "simplelogin": {
        if (!config.apiKey) {
          return { success: false, message: "API key is required." };
        }
        const provider = new SimpleLoginProvider(config.apiKey);
        return provider.testConnection();
      }
      case "addy": {
        if (!config.apiKey) {
          return { success: false, message: "API key is required." };
        }
        const provider = new AddyProvider(config.apiKey);
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

  async getAliasPreview(type: ProviderType): Promise<AliasPreviewResult | null> {
    switch (type) {
      case "simplelogin": {
        const provider = this.providers.get("simplelogin") as SimpleLoginProvider | undefined;
        return (await provider?.getAliasPreview()) ?? null;
      }
      case "addy": {
        const provider = this.providers.get("addy") as AddyProvider | undefined;
        return (await provider?.getAliasPreview()) ?? null;
      }
      default:
        return null;
    }
  }

  async getForwardTargets(type: ProviderType): Promise<ForwardTarget[]> {
    const provider = this.providers.get(type);
    if (!provider) {
      return [];
    }

    return provider.listForwardTargets();
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
