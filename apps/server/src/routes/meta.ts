import { Router } from "express";
import { z } from "zod";
import { ProviderRegistry } from "../providers/providerRegistry";
import { ProviderType } from "../providers/providerCatalog";
import { SettingsService, updateSettingsSchema } from "../services/settingsService";

const testConnectionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("mock"),
    config: z.object({})
  }),
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

export function createMetaRouter(providerRegistry: ProviderRegistry, settingsService: SettingsService): Router {
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
    return res.json(result);
  });

  router.get("/providers/active/suffix", async (_req, res) => {
    const activeProvider = settingsService.getActiveProvider();
    if (!activeProvider) {
      return res.json({ suffix: null });
    }
    try {
      const suffix = await providerRegistry.getAliasSuffix(activeProvider.type);
      return res.json({ suffix });
    } catch {
      return res.json({ suffix: null });
    }
  });

  router.get("/forward-addresses", (_req, res) => {
    return res.json({ forwardAddresses: settingsService.getSettings().uiSettings.forwardAddresses });
  });

  router.get("/settings", (_req, res) => {
    return res.json(settingsService.getSettings());
  });

  router.put("/settings", (req, res) => {
    const parsed = updateSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const nextSettings = settingsService.updateSettings(parsed.data);
    providerRegistry.reconfigure(nextSettings.providerSettings.providers);
    return res.json(nextSettings);
  });

  router.get("/health", (_req, res) => {
    return res.json({ ok: true });
  });

  return router;
}
