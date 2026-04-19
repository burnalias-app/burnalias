import { z } from "zod";

const providerBaseSchema = {
  id: z.string().trim().min(1),
  name: z.string().trim().min(1).max(64)
};

export const simpleLoginProviderConfigSchema = z.object({
  ...providerBaseSchema,
  type: z.literal("simplelogin"),
  config: z.object({
    apiKey: z.string().default(""),
    hasStoredSecret: z.boolean().optional().default(false),
    clearStoredSecret: z.boolean().optional().default(false),
    lastConnectionTestSucceededAt: z.string().datetime().nullable().optional().default(null),
    lastConnectionTestVerificationToken: z.string().min(1).nullable().optional().default(null)
  })
});

export const addyProviderConfigSchema = z.object({
  ...providerBaseSchema,
  type: z.literal("addy"),
  config: z.object({
    apiKey: z.string().default(""),
    hasStoredSecret: z.boolean().optional().default(false),
    clearStoredSecret: z.boolean().optional().default(false),
    lastConnectionTestSucceededAt: z.string().datetime().nullable().optional().default(null),
    lastConnectionTestVerificationToken: z.string().min(1).nullable().optional().default(null),
    supportsCustomAliases: z.boolean().nullable().optional().default(null),
    defaultAliasDomain: z.string().min(1).nullable().optional().default(null),
    defaultAliasFormat: z.string().min(1).nullable().optional().default(null),
    domainOptions: z.array(z.string().min(1)).optional().default([]),
    maxRecipientCount: z.number().int().positive().nullable().optional().default(null)
  })
});

export const configuredProviderSchema = z.discriminatedUnion("type", [
  simpleLoginProviderConfigSchema,
  addyProviderConfigSchema
]);

export type ConfiguredProvider = z.infer<typeof configuredProviderSchema>;
