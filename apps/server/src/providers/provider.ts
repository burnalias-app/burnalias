import { ProviderAlias } from "../domain/alias";

export interface CreateProviderAliasInput {
  localPart: string;
  destinationEmail?: string;
  domainName?: string;
  aliasFormat?: string | null;
  label?: string | null;
  note?: string | null;
  providerHint?: string | null;
}

export interface ProviderPreviewInput {
  aliasFormat?: string | null;
  domainName?: string | null;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  capabilities?: {
    supportsCustomAliases?: boolean;
    defaultAliasDomain?: string | null;
    defaultAliasFormat?: string | null;
    domainOptions?: string[];
    maxRecipientCount?: number | null;
  };
}

export interface AliasPreviewResult {
  displaySuffix: string;
  providerHint: string;
  usesTypedLocalPart?: boolean;
  generatedLocalPartLabel?: string | null;
  aliasFormatOptions?: Array<{ value: string; label: string }>;
  selectedAliasFormat?: string | null;
  domainOptions?: Array<{ value: string; label: string }>;
  selectedDomain?: string | null;
  maxRecipientCount?: number | null;
}

export interface ForwardTarget {
  email: string;
  isDefault: boolean;
}

export interface UpdateProviderAliasMetadataInput {
  note?: string | null;
  destinationEmail?: string;
}

export interface AliasProvider {
  readonly name: string;
  testConnection(): Promise<ConnectionTestResult>;
  getConfigurationCapabilities?(): Promise<ConnectionTestResult["capabilities"] | undefined>;
  listForwardTargets(): Promise<ForwardTarget[]>;
  getAliasPreview(input?: ProviderPreviewInput): Promise<AliasPreviewResult | null>;
  createAlias(input: CreateProviderAliasInput): Promise<ProviderAlias>;
  updateAliasMetadata(providerAliasId: string, input: UpdateProviderAliasMetadataInput): Promise<void>;
  disableAlias(providerAliasId: string): Promise<void>;
  enableAlias(providerAliasId: string): Promise<void>;
  deleteAlias(providerAliasId: string): Promise<void>;
  listAliases(): Promise<ProviderAlias[]>;
}
