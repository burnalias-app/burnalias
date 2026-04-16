import { config } from "../config";
import { verifyPassword } from "../lib/auth";
import { SessionRecord, SessionRepository } from "../repositories/sessionRepository";

export class AuthService {
  constructor(private readonly sessionRepository: SessionRepository) {}

  validateConfig(): void {
    if (!config.authUsername || !config.authPasswordHash || !config.sessionSecret) {
      throw new Error(
        "BurnAlias auth is not configured. Set BURN_USER and BURN_PASSWORD_HASH before starting the app. The server checks .env in the repo root and apps/server."
      );
    }
  }

  async login(username: string, password: string): Promise<SessionRecord | null> {
    if (!config.authUsername || !config.authPasswordHash) {
      return null;
    }

    if (username !== config.authUsername) {
      return null;
    }

    const isValid = await verifyPassword(password, config.authPasswordHash);
    if (!isValid) {
      return null;
    }

    return this.sessionRepository.create(config.sessionTtlMs);
  }

  getSession(sessionId: string | null): SessionRecord | null {
    if (!sessionId) {
      return null;
    }

    this.sessionRepository.deleteExpired(new Date().toISOString());
    return this.sessionRepository.findValidById(sessionId, new Date().toISOString());
  }

  logout(sessionId: string | null): void {
    if (!sessionId) {
      return;
    }

    this.sessionRepository.delete(sessionId);
  }
}
