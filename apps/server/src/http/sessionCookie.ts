import { createHmac, timingSafeEqual } from "crypto";
import { config } from "../config";

export const SESSION_COOKIE_NAME = "burnalias_session";

function getSigningKey(): string {
  if (!config.sessionSecret) {
    throw new Error("Session secret is not configured.");
  }

  return config.sessionSecret;
}

export function signSessionId(sessionId: string): string {
  const signature = createHmac("sha256", getSigningKey()).update(sessionId).digest("base64url");
  return `${sessionId}.${signature}`;
}

export function unsignSessionId(signedValue: string | undefined): string | null {
  if (!signedValue) {
    return null;
  }

  const lastDot = signedValue.lastIndexOf(".");
  if (lastDot <= 0) {
    return null;
  }

  const sessionId = signedValue.slice(0, lastDot);
  const signature = signedValue.slice(lastDot + 1);
  const expected = createHmac("sha256", getSigningKey()).update(sessionId).digest("base64url");

  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return null;
  }

  return sessionId;
}
