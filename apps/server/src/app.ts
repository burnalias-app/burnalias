import express from "express";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";
import path from "path";
import { config } from "./config";
import { logger } from "./lib/logger";
import { createDatabase } from "./db/database";
import { requireAuth } from "./http/authMiddleware";
import { requireCsrfForStateChanges } from "./http/csrfMiddleware";
import { ProviderRegistry } from "./providers/providerRegistry";
import { AliasRepository } from "./repositories/aliasRepository";
import { AuditLogRepository } from "./repositories/auditLogRepository";
import { SchedulerJobRepository } from "./repositories/schedulerJobRepository";
import { SessionRepository } from "./repositories/sessionRepository";
import { createAliasRouter } from "./routes/aliases";
import { createAuthRouter } from "./routes/auth";
import { createMetaRouter } from "./routes/meta";
import { AliasService } from "./services/aliasService";
import { AuthService } from "./services/authService";
import { ExpirationScheduler } from "./services/expirationScheduler";
import { SettingsService } from "./services/settingsService";

function serializeRequestSummary(req: express.Request & { id?: string }) {
  return {
    id: req.id,
    method: req.method,
    url: req.url
  };
}

function serializeResponseSummary(res: express.Response) {
  return {
    statusCode: res.statusCode
  };
}

export function createApp() {
  const db = createDatabase();
  const providerRegistry = new ProviderRegistry();
  const aliasRepository = new AliasRepository(db);
  const auditLogRepository = new AuditLogRepository(db);
  const schedulerJobRepository = new SchedulerJobRepository(db);
  const sessionRepository = new SessionRepository(db);
  const settingsService = new SettingsService(
    db,
    config.authUsername,
    config.sessionTtlMs,
    providerRegistry.listSupportedProviders(),
    aliasRepository,
    auditLogRepository
  );
  // Restore any real providers that were configured before the server started
  providerRegistry.reconfigure(settingsService.getInternalSettings().providerSettings.providers);

  const aliasService = new AliasService(aliasRepository, auditLogRepository, providerRegistry, settingsService);
  const authService = new AuthService(sessionRepository);
  const scheduler = new ExpirationScheduler(
    aliasRepository,
    auditLogRepository,
    schedulerJobRepository,
    providerRegistry,
    settingsService,
    config.expirationCheckIntervalMs,
    config.historyPurgeIntervalMs,
    config.providerSyncIntervalMs
  );

  const app = express();
  app.use(
    pinoHttp({
      logger,
      redact: ["req.headers.cookie", "req.headers.authorization"],
      autoLogging: {
        ignore: (req) => req.url === "/api/health"
      },
      serializers: {
        req: (req) => serializeRequestSummary(req as express.Request & { id?: string }),
        res: (res) => serializeResponseSummary(res as express.Response)
      },
      customSuccessMessage: (req, res) => `${req.method} ${req.url} -> ${res.statusCode}`,
      customErrorMessage: (req, res, err) =>
        `${req.method} ${req.url} -> ${res.statusCode}${err ? ` (${err.message})` : ""}`,
      customLogLevel: (req, res, err) => {
        if (err || res.statusCode >= 500) return "error";
        if (res.statusCode >= 400) return "warn";
        if (req.method === "GET") return "trace";
        return "info";
      }
    })
  );
  app.use(express.json());
  app.use((req, res, next) => {
    if (!logger.isLevelEnabled("trace") || req.url === "/api/health") {
      return next();
    }

    const startedAt = process.hrtime.bigint();
    res.on("finish", () => {
      const responseTime = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      req.log.trace(
        {
          request: {
            id: (req as express.Request & { id?: string }).id,
            method: req.method,
            url: req.url,
            query: req.query,
            params: req.params,
            headers: req.headers,
            remoteAddress: req.socket.remoteAddress,
            remotePort: req.socket.remotePort
          },
          response: {
            statusCode: res.statusCode,
            headers: res.getHeaders()
          },
          responseTime: Math.round(responseTime)
        },
        "HTTP trace"
      );
    });

    return next();
  });

  const loginRateLimiter = rateLimit({
    windowMs: config.loginRateLimitWindowMs,
    limit: config.loginRateLimitMaxAttempts,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: {
      error: "Too many login attempts. Try again later."
    }
  });

  app.use("/api/auth", createAuthRouter(authService, loginRateLimiter));
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api", requireAuth(authService));
  app.use("/api", requireCsrfForStateChanges);
  app.use("/api/aliases", createAliasRouter(aliasService, scheduler));
  app.use("/api", createMetaRouter(providerRegistry, settingsService, scheduler, auditLogRepository));

  const webDistPath = path.resolve(__dirname, "..", "..", "web", "dist");
  app.use(express.static(webDistPath));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) {
      return next();
    }

    return res.sendFile(path.join(webDistPath, "index.html"));
  });

  return { app, scheduler, authService };
}
