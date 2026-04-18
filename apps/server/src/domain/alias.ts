export type AliasStatus = "active" | "inactive" | "expired" | "deleted";

export interface Alias {
  id: string;
  email: string;
  providerName: string;
  providerAliasId: string;
  destinationEmail: string;
  createdAt: string;
  expiresAt: string | null;
  status: AliasStatus;
  label: string | null;
}

export interface ProviderAlias {
  id: string;
  email: string;
  destinationEmail: string;
  enabled: boolean;
  label: string | null;
}
