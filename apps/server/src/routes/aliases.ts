import { Router } from "express";
import { z } from "zod";
import { AliasService, createAliasSchema } from "../services/aliasService";
import { ExpirationScheduler } from "../services/expirationScheduler";

const statusSchema = z.enum(["active", "inactive", "expired", "deleted"]);

export function createAliasRouter(aliasService: AliasService, scheduler: ExpirationScheduler): Router {
  const router = Router();

  router.get("/", (req, res) => {
    const parsedStatus = req.query.status ? statusSchema.safeParse(req.query.status) : null;
    if (parsedStatus && !parsedStatus.success) {
      return res.status(400).json({ error: "Invalid status filter." });
    }

    return res.json({
      aliases: aliasService.listAliases(parsedStatus?.success ? parsedStatus.data : undefined)
    });
  });

  router.post("/", async (req, res) => {
    const parsed = createAliasSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    try {
      const alias = await aliasService.createAlias(parsed.data);
      return res.status(201).json({ alias });
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : "Unable to create alias."
      });
    }
  });

  router.post("/:id/enable", async (req, res) => {
    try {
      const alias = await aliasService.setAliasStatus(req.params.id, "active");
      return res.json({ alias });
    } catch (error) {
      const status = error instanceof Error && error.message === "Alias not found" ? 404 : 400;
      return res.status(status).json({
        error: error instanceof Error ? error.message : "Unable to enable alias."
      });
    }
  });

  router.post("/:id/disable", async (req, res) => {
    try {
      const alias = await aliasService.setAliasStatus(req.params.id, "inactive");
      return res.json({ alias });
    } catch (error) {
      const status = error instanceof Error && error.message === "Alias not found" ? 404 : 400;
      return res.status(status).json({
        error: error instanceof Error ? error.message : "Unable to disable alias."
      });
    }
  });

  router.post("/sync", async (_req, res) => {
    try {
      await scheduler.runJob("provider-sync");
      return res.status(204).send();
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : "Unable to sync aliases."
      });
    }
  });

  router.patch("/:id/expiration", async (req, res) => {
    const parsed = z.object({
      expiresInHours: z.coerce.number().int().min(1).max(87600).nullable()
    }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    try {
      const alias = await aliasService.updateExpiration(req.params.id, parsed.data.expiresInHours);
      return res.json({ alias });
    } catch (error) {
      const status = error instanceof Error && error.message === "Alias not found" ? 404 : 400;
      return res.status(status).json({
        error: error instanceof Error ? error.message : "Unable to update expiration."
      });
    }
  });

  router.delete("/:id", async (req, res) => {
    try {
      await aliasService.deleteAlias(req.params.id);
      return res.status(204).send();
    } catch (error) {
      const status = error instanceof Error && error.message === "Alias not found" ? 404 : 400;
      return res.status(status).json({
        error: error instanceof Error ? error.message : "Unable to delete alias."
      });
    }
  });

  router.get("/:id/audit", (req, res) => {
    return res.json({
      audit: aliasService.listAuditLog(req.params.id)
    });
  });

  return router;
}
