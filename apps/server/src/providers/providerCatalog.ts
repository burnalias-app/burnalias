export type ProviderType = "simplelogin" | "addy";

export interface SupportedProviderDefinition {
  type: ProviderType;
  label: string;
  description: string;
  implemented: boolean;
}

export const supportedProviders: SupportedProviderDefinition[] = [
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
    implemented: true
  }
];
