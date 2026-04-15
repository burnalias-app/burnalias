import { NextFunction, Request, Response } from "express";
import { AuthService } from "../services/authService";
import { parseCookies, serializeCookie } from "./cookies";
import { SESSION_COOKIE_NAME, unsignSessionId } from "./sessionCookie";

declare global {
  namespace Express {
    interface Request {
      authSession?: {
        id: string;
        csrfToken: string;
      } | null;
    }
  }
}

export function requireAuth(authService: AuthService) {
  return (req: Request, res: Response, next: NextFunction) => {
    const cookies = parseCookies(req.headers.cookie);
    const signedSessionId = cookies[SESSION_COOKIE_NAME];
    const sessionId = unsignSessionId(signedSessionId);
    const session = authService.getSession(sessionId);

    if (!session) {
      res.setHeader(
        "Set-Cookie",
        serializeCookie(SESSION_COOKIE_NAME, "", {
          maxAge: 0,
          path: "/",
          httpOnly: true,
          sameSite: "Strict"
        })
      );
      return res.status(401).json({ error: "Authentication required." });
    }

    req.authSession = {
      id: session.id,
      csrfToken: session.csrfToken
    };
    return next();
  };
}
