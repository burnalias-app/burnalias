import { Router } from "express";
import { z } from "zod";
import { ProviderRegistry } from "../providers/providerRegistry";
import { ProviderType } from "../providers/providerCatalog";
import { createSecretVerificationToken } from "../lib/secrets";
import { ExpirationScheduler, SchedulerJobId } from "../services/expirationScheduler";
import { SettingsService, updateSettingsSchema } from "../services/settingsService";

const testConnectionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("simplelogin"),
    config: z.object({ apiKey: z.string().min(1, "API key is required.") })
  }),
  z.object({
    type: z.literal("addy"),
    config: z.object({})
  }),
  z.object({
    type: z.literal("cloudflare"),
    config: z.object({})
  })
]);

const runJobSchema = z.object({
  jobId: z.enum(["expiration-sweep", "terminal-history-purge", "provider-sync"])
});

export function createMetaRouter(
  providerRegistry: ProviderRegistry,
  settingsService: SettingsService,
  scheduler: ExpirationScheduler
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
    if (
      result.success &&
      parsed.data.type === "simplelogin" &&
      "apiKey" in parsed.data.config
    ) {
      const testedAt = new Date().toISOString();
      return res.json({
        ...result,
        testedAt,
        verificationToken: createSecretVerificationToken(parsed.data.config.apiKey)
      });
    }

    return res.json(result);
  });

  router.get("/providers/active/suffix", async (_req, res) => {
    const activeProvider = settingsService.getActiveProvider();
    if (!activeProvider) {
      return res.json({ suffix: null, providerHint: null });
    }
    try {
      const preview = await providerRegistry.getAliasPreview(activeProvider.type);
      return res.json({
        suffix: preview?.displaySuffix ?? null,
        providerHint: preview?.providerHint ?? null
      });
    } catch {
      return res.json({ suffix: null, providerHint: null });
    }
  });

  router.get("/forward-addresses", (_req, res) => {
    const activeProvider = settingsService.getActiveProvider();

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
