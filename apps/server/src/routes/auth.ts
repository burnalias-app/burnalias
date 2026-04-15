import { RequestHandler, Router } from "express";
import { z } from "zod";
import { config } from "../config";
import { requireAuth } from "../http/authMiddleware";
import { requireCsrfForStateChanges } from "../http/csrfMiddleware";
import { serializeCookie, parseCookies } from "../http/cookies";
import { SESSION_COOKIE_NAME, signSessionId, unsignSessionId } from "../http/sessionCookie";
import { AuthService } from "../services/authService";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

export function createAuthRouter(authService: AuthService, loginRateLimiter: RequestHandler): Router {
  const router = Router();

  router.get("/session", (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const sessionId = unsignSessionId(cookies[SESSION_COOKIE_NAME]);
    const session = authService.getSession(sessionId);

    if (!session) {
      return res.json({ authenticated: false });
    }

    return res.json({
      authenticated: true,
      csrfToken: session.csrfToken,
      user: {
        username: config.authUsername
      }
    });
  });

  router.post("/login", loginRateLimiter, async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid login request." });
    }

    const session = await authService.login(parsed.data.username, parsed.data.password);
    if (!session) {
      return res.status(401).json({ error: "Invalid username or password." });
    }

    res.setHeader(
      "Set-Cookie",
      serializeCookie(SESSION_COOKIE_NAME, signSessionId(session.id), {
        maxAge: Math.floor(config.sessionTtlMs / 1000),
        path: "/",
        httpOnly: true,
        sameSite: "Strict",
        secure: config.nodeEnv === "production"
      })
    );

    return res.json({
      authenticated: true,
      csrfToken: session.csrfToken,
      user: {
        username: config.authUsername
      }
    });
  });

  router.post("/logout", requireAuth(authService), requireCsrfForStateChanges, (req, res) => {
    authService.logout(req.authSession?.id ?? null);

    res.setHeader(
      "Set-Cookie",
      serializeCookie(SESSION_COOKIE_NAME, "", {
        maxAge: 0,
        path: "/",
        httpOnly: true,
        sameSite: "Strict",
        secure: config.nodeEnv === "production"
      })
    );

    return res.status(204).send();
  });

  return router;
}
