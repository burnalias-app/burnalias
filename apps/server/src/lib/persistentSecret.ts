import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";

export function readOrCreatePersistentSecret(secretPath: string): string | null {
  try {
    if (fs.existsSync(secretPath)) {
      const secret = fs.readFileSync(secretPath, "utf8").trim();
      return secret || null;
    }

    fs.mkdirSync(path.dirname(secretPath), { recursive: true });
    const secret = randomBytes(32).toString("hex");
    fs.writeFileSync(secretPath, `${secret}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    return secret;
  } catch {
    try {
      const secret = fs.readFileSync(secretPath, "utf8").trim();
      return secret || null;
    } catch {
      return null;
    }
  }
}
