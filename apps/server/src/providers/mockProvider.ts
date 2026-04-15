import { config } from "../config";
import { ProviderAlias } from "../domain/alias";
import { createId } from "../lib/id";
import { AliasProvider, ConnectionTestResult, CreateProviderAliasInput } from "./provider";

export class MockAliasProvider implements AliasProvider {
  readonly name = "mock";
  private readonly aliases = new Map<string, ProviderAlias>();

  async testConnection(): Promise<ConnectionTestResult> {
    return { success: true, message: "Mock provider — no external connection needed." };
  }

  async createAlias(input: CreateProviderAliasInput): Promise<ProviderAlias> {
    const alias: ProviderAlias = {
      id: createId(),
      email: `${input.localPart}@${input.domainName ?? config.mockProviderDomain}`,
      destinationEmail: input.destinationEmail ?? "",
      enabled: true
    };

    this.aliases.set(alias.id, alias);
    return alias;
  }

  async disableAlias(providerAliasId: string): Promise<void> {
    const alias = this.aliases.get(providerAliasId);
    if (alias) {
      alias.enabled = false;
    }
  }

  async enableAlias(providerAliasId: string): Promise<void> {
    const alias = this.aliases.get(providerAliasId);
    if (alias) {
      alias.enabled = true;
    }
  }

  async deleteAlias(providerAliasId: string): Promise<void> {
    this.aliases.delete(providerAliasId);
  }

  async listAliases(): Promise<ProviderAlias[]> {
    return Array.from(this.aliases.values());
  }
}
