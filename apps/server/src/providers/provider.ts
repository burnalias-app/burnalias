import { ProviderAlias } from "../domain/alias";

export interface CreateProviderAliasInput {
  localPart: string;
  destinationEmail?: string;
  domainName?: string;
  label?: string | null;
  note?: string | null;
  providerHint?: string | null;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
}

export interface AliasPreviewResult {
  displaySuffix: string;
  providerHint: string;
}

export interface ForwardTarget {
  email: string;
  isDefault: boolean;
}

export interface AliasProvider {
  readonly name: string;
  testConnection(): Promise<ConnectionTestResult>;
  listForwardTargets(): Promise<ForwardTarget[]>;
  createAlias(input: CreateProviderAliasInput): Promise<ProviderAlias>;
  disableAlias(providerAliasId: string): Promise<void>;
  enableAlias(providerAliasId: string): Promise<void>;
  deleteAlias(providerAliasId: string): Promise<void>;
  listAliases(): Promise<ProviderAlias[]>;
}
