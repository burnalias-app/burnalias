import { Router } from "express";
import { z } from "zod";
import { ProviderRegistry } from "../providers/providerRegistry";
import { ProviderType } from "../providers/providerCatalog";
import { createSecretVerificationToken } from "../lib/secrets";
import { ExpirationScheduler, SchedulerJobId } from "../services/expirationScheduler";
import { AuditLogRepository } from "../repositories/auditLogRepository";
import { SettingsService, updateSettingsSchema } from "../services/settingsService";

const testConnectionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("simplelogin"),
    config: z.object({ apiKey: z.string().min(1, "API key is required.") })
  }),
  z.object({
    type: z.literal("addy"),
    config: z.object({ apiKey: z.string().min(1, "API key is required.") })
  })
]);

const runJobSchema = z.object({
  jobId: z.enum(["expiration-sweep", "terminal-history-purge", "provider-sync"])
});

const providerQuerySchema = z.object({
  providerType: z.enum(["simplelogin", "addy"]).optional(),
  aliasFormat: z.string().min(1).optional(),
  domainName: z.string().min(1).optional()
});

function buildStoredAddyPreview(
  provider: Extract<ReturnType<SettingsService["getProviderByType"]>, { type: "addy" }>,
  options?: { aliasFormat?: string; domainName?: string }
) {
  const supportsCustomAliases = provider.config.supportsCustomAliases === true;
  const availableFormats = supportsCustomAliases
    ? ["custom", "random_words", "random_male_name", "random_female_name", "random_noun", "random_characters", "uuid"]
    : ["random_characters", "uuid"];
  const domainOptions =
    provider.config.domainOptions && provider.config.domainOptions.length > 0
      ? provider.config.domainOptions
      : provider.config.defaultAliasDomain
        ? [provider.config.defaultAliasDomain]
        : [];
  const selectedDomain =
    options?.domainName && domainOptions.includes(options.domainName)
      ? options.domainName
      : provider.config.defaultAliasDomain ?? domainOptions[0] ?? null;
  const defaultFreePlanFormat =
    provider.config.defaultAliasFormat && ["random_characters", "uuid"].includes(provider.config.defaultAliasFormat)
      ? provider.config.defaultAliasFormat
      : "random_characters";
  const defaultPaidFormat =
    provider.config.defaultAliasFormat && availableFormats.includes(provider.config.defaultAliasFormat)
      ? provider.config.defaultAliasFormat
      : "custom";
  const selectedAliasFormat =
    options?.aliasFormat && availableFormats.includes(options.aliasFormat)
      ? options.aliasFormat
      : supportsCustomAliases
        ? defaultPaidFormat
        : defaultFreePlanFormat;

  if (!selectedDomain) {
    return null;
  }

  return {
    suffix: `@${selectedDomain}`,
    providerHint: selectedDomain,
    usesTypedLocalPart: selectedAliasFormat === "custom",
    generatedLocalPartLabel: selectedAliasFormat === "custom"
      ? null
      : selectedAliasFormat === "uuid"
        ? "uuid"
        : selectedAliasFormat === "random_words"
          ? "random-words"
          : selectedAliasFormat === "random_male_name"
            ? "random-male-name"
            : selectedAliasFormat === "random_female_name"
              ? "random-female-name"
              : selectedAliasFormat === "random_noun"
                ? "random-noun"
                : "random-characters",
    aliasFormatOptions: availableFormats.map((format) => ({
      value: format,
      label:
        format === "custom"
          ? "Custom Alias"
          : format === "random_words"
            ? "Random Words"
            : format === "random_male_name"
              ? "Random Male Name"
              : format === "random_female_name"
                ? "Random Female Name"
                : format === "random_noun"
                  ? "Random Noun"
                  : format === "random_characters"
                    ? "Random characters"
                    : "UUID"
    })),
    selectedAliasFormat,
    domainOptions: domainOptions.map((domain) => ({ value: domain, label: domain })),
    selectedDomain,
    maxRecipientCount: provider.config.maxRecipientCount ?? null
  };
}

export function createMetaRouter(
  providerRegistry: ProviderRegistry,
  settingsService: SettingsService,
  scheduler: ExpirationScheduler,
  auditLogRepository: AuditLogRepository
): Router {
  const router = Router();

  router.get("/providers", (_req, res) => {
    return res.json({ providers: providerRegistry.listSupportedProviders() });
  });

  router.post("/providers/test", async (req, res) => {
    const parsed = testConnectionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const result = await providerRegistry.testConnection(
      parsed.data.type as ProviderType,
      parsed.data.config as Record<string, string>
    );
    if (result.success && parsed.data.type === "simplelogin" && "apiKey" in parsed.data.config) {
      const testedAt = new Date().toISOString();
      return res.json({
        ...result,
        testedAt,
        verificationToken: createSecretVerificationToken(parsed.data.config.apiKey)
      });
    }

    if (result.success && parsed.data.type === "addy" && "apiKey" in parsed.data.config) {
      const testedAt = new Date().toISOString();
      return res.json({
        ...result,
        testedAt,
        verificationToken: createSecretVerificationToken(parsed.data.config.apiKey)
      });
    }

    return res.json(result);
  });

  router.get("/providers/active/suffix", async (req, res) => {
    const parsedQuery = providerQuerySchema.safeParse(req.query);
    const selectedProvider = parsedQuery.success && parsedQuery.data.providerType
      ? settingsService.getProviderByType(parsedQuery.data.providerType)
      : settingsService.getActiveProvider();
    if (!selectedProvider) {
      return res.json({ suffix: null, providerHint: null, usesTypedLocalPart: true, generatedLocalPartLabel: null });
    }
    if (selectedProvider.type === "addy") {
      const storedPreview = buildStoredAddyPreview(selectedProvider, parsedQuery.success ? parsedQuery.data : undefined);
      if (storedPreview) {
        return res.json(storedPreview);
      }
    }
    try {
      const preview = await providerRegistry.getAliasPreview(selectedProvider.type, {
        aliasFormat: parsedQuery.success ? parsedQuery.data.aliasFormat ?? null : null,
        domainName: parsedQuery.success ? parsedQuery.data.domainName ?? null : null
      });
      return res.json({
        suffix: preview?.displaySuffix ?? null,
        providerHint: preview?.providerHint ?? null,
        usesTypedLocalPart: preview?.usesTypedLocalPart ?? true,
        generatedLocalPartLabel: preview?.generatedLocalPartLabel ?? null,
        aliasFormatOptions: preview?.aliasFormatOptions ?? [],
        selectedAliasFormat: preview?.selectedAliasFormat ?? null,
        domainOptions: preview?.domainOptions ?? [],
        selectedDomain: preview?.selectedDomain ?? null,
        maxRecipientCount: preview?.maxRecipientCount ?? null
      });
    } catch {
      return res.json({
        suffix: null,
        providerHint: null,
        usesTypedLocalPart: true,
        generatedLocalPartLabel: null,
        aliasFormatOptions: [],
        selectedAliasFormat: null,
        domainOptions: [],
        selectedDomain: null,
        maxRecipientCount: null
      });
    }
  });

  router.get("/forward-addresses", (_req, res) => {
    const parsedQuery = providerQuerySchema.safeParse(_req.query);
    const activeProvider = parsedQuery.success && parsedQuery.data.providerType
      ? settingsService.getProviderByType(parsedQuery.data.providerType)
      : settingsService.getActiveProvider();

    if (!activeProvider) {
      return res.json({
        forwardAddresses: [],
        source: "none",
        providerName: null
      });
    }

    if (!providerRegistry.isImplemented(activeProvider.type)) {
      return res.json({
        forwardAddresses: [],
        source: "none",
        providerName: activeProvider.name
      });
    }

    return providerRegistry
      .getForwardTargets(activeProvider.type)
      .then((targets) => {
        const sortedTargets = [...targets].sort((left, right) => {
          if (left.isDefault === right.isDefault) {
            return left.email.localeCompare(right.email);
          }

          return left.isDefault ? -1 : 1;
        });

        return res.json({
          forwardAddresses: sortedTargets.map((target) => target.email),
          source: sortedTargets.length > 0 ? "provider" : "none",
          providerName: activeProvider.name
        });
      })
      .catch(() =>
        res.json({
          forwardAddresses: [],
          source: "none",
          providerName: activeProvider.name
        })
      );
  });

  router.get("/settings", (_req, res) => {
    return res.json(settingsService.getSettings());
  });

  router.get("/jobs", (_req, res) => {
    return res.json({ jobs: scheduler.listJobs() });
  });

  router.get("/history", (_req, res) => {
    return res.json({ history: auditLogRepository.listRecent(150) });
  });

  router.post("/jobs/:jobId/run", async (req, res) => {
    const parsed = runJobSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid job id." });
    }

    try {
      await scheduler.runJob(parsed.data.jobId as SchedulerJobId);
      return res.status(204).send();
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : "Unable to run job."
      });
    }
  });

  router.put("/settings", (req, res) => {
    const parsed = updateSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    try {
      settingsService.updateSettings(parsed.data);
      providerRegistry.reconfigure(settingsService.getInternalSettings().providerSettings.providers);
      return res.json(settingsService.getSettings());
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : "Unable to save settings."
      });
    }
  });

  router.get("/health", (_req, res) => {
    return res.json({ ok: true });
  });

  return router;
}
