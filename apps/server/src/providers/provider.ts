import { ProviderAlias } from "../domain/alias";

export interface CreateProviderAliasInput {
  localPart: string;
  destinationEmail?: string;
  domainName?: string;
  label?: string | null;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
}

export interface AliasProvider {
  readonly name: string;
  testConnection(): Promise<ConnectionTestResult>;
  createAlias(input: CreateProviderAliasInput): Promise<ProviderAlias>;
  disableAlias(providerAliasId: string): Promise<void>;
  enableAlias(providerAliasId: string): Promise<void>;
  deleteAlias(providerAliasId: string): Promise<void>;
  listAliases(): Promise<ProviderAlias[]>;
}
