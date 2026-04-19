import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "crypto";
import { config } from "../config";

const ENCRYPTED_PREFIX = "enc:v1:";

function getPrimarySecretsSource(): string {
  return config.secretsKey ?? config.sessionSecret ?? "";
}

function getSecretsKey(): Buffer {
  const source = getPrimarySecretsSource();
  return createHash("sha256").update(source).digest();
}

export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX);
}

export function encryptSecret(plaintext: string): string {
  if (!plaintext) {
    return plaintext;
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getSecretsKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${ENCRYPTED_PREFIX}${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptSecret(value: string): string {
  if (!value || !isEncryptedSecret(value)) {
    return value;
  }

  const payload = value.slice(ENCRYPTED_PREFIX.length);
  const [ivBase64, authTagBase64, encryptedBase64] = payload.split(":");
  if (!ivBase64 || !authTagBase64 || !encryptedBase64) {
    throw new Error("Encrypted secret payload is malformed.");
  }

  const iv = Buffer.from(ivBase64, "base64");
  const authTag = Buffer.from(authTagBase64, "base64");
  const encrypted = Buffer.from(encryptedBase64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", getSecretsKey(), iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

export function createSecretVerificationToken(secret: string): string {
  return createHmac("sha256", getSecretsKey()).update(secret).digest("base64url");
}
