import { z } from "zod";

export const aliasDomainSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, "Alias domain must look like a valid domain name.");

const providerBaseSchema = {
  id: z.string().trim().min(1),
  name: z.string().trim().min(1).max(64),
  enabled: z.boolean()
};

export const mockProviderConfigSchema = z.object({
  ...providerBaseSchema,
  type: z.literal("mock"),
  config: z.object({
    aliasDomain: aliasDomainSchema
  })
});

export const simpleLoginProviderConfigSchema = z.object({
  ...providerBaseSchema,
  type: z.literal("simplelogin"),
  config: z.object({
    apiKey: z.string().default("")
  })
});

export const addyProviderConfigSchema = z.object({
  ...providerBaseSchema,
  type: z.literal("addy"),
  config: z.object({})
});

export const cloudflareProviderConfigSchema = z.object({
  ...providerBaseSchema,
  type: z.literal("cloudflare"),
  config: z.object({})
});

export const configuredProviderSchema = z.discriminatedUnion("type", [
  mockProviderConfigSchema,
  simpleLoginProviderConfigSchema,
  addyProviderConfigSchema,
  cloudflareProviderConfigSchema
]);

export type ConfiguredProvider = z.infer<typeof configuredProviderSchema>;
