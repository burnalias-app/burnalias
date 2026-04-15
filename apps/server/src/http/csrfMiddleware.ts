import { timingSafeEqual } from "crypto";
import { NextFunction, Request, Response } from "express";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CSRF_HEADER_NAME = "x-csrf-token";

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function requireCsrfForStateChanges(req: Request, res: Response, next: NextFunction) {
  if (!UNSAFE_METHODS.has(req.method.toUpperCase())) {
    return next();
  }

  const csrfToken = req.get(CSRF_HEADER_NAME);
  const expectedToken = req.authSession?.csrfToken;

  if (!csrfToken || !expectedToken || !safeEqual(csrfToken, expectedToken)) {
    return res.status(403).json({ error: "Invalid CSRF token." });
  }

  return next();
}
