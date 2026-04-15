export type ProviderType = "mock" | "simplelogin" | "addy" | "cloudflare";

export interface SupportedProviderDefinition {
  type: ProviderType;
  label: string;
  description: string;
  implemented: boolean;
}

export const supportedProviders: SupportedProviderDefinition[] = [
  {
    type: "mock",
    label: "Mock provider",
    description: "Local development provider for testing alias flows end-to-end.",
    implemented: true
  },
  {
    type: "simplelogin",
    label: "SimpleLogin",
    description: "Third-party alias routing through SimpleLogin.",
    implemented: true
  },
  {
    type: "addy",
    label: "Addy.io",
    description: "Third-party alias routing through Addy.io / AnonAddy.",
    implemented: false
  },
  {
    type: "cloudflare",
    label: "Cloudflare Email Routing",
    description: "Alias routing through Cloudflare Email Routing.",
    implemented: false
  }
];
