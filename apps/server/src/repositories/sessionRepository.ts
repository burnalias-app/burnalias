import Database from "better-sqlite3";
import { createId } from "../lib/id";

export interface SessionRecord {
  id: string;
  csrfToken: string;
  createdAt: string;
  expiresAt: string;
}

type SessionRow = {
  id: string;
  csrf_token: string | null;
  created_at: string;
  expires_at: string;
};

function mapSession(row: SessionRow): SessionRecord | null {
  if (!row.csrf_token) {
    return null;
  }

  return {
    id: row.id,
    csrfToken: row.csrf_token,
    createdAt: row.created_at,
    expiresAt: row.expires_at
  };
}

export class SessionRepository {
  constructor(private readonly db: Database.Database) {}

  create(ttlMs: number): SessionRecord {
    const now = new Date();
    const session: SessionRecord = {
      id: createId(),
      csrfToken: createId(),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString()
    };

    this.db
      .prepare(`
        INSERT INTO sessions (id, csrf_token, expires_at, created_at)
        VALUES (@id, @csrfToken, @expiresAt, @createdAt)
      `)
      .run(session);

    return session;
  }

  findValidById(id: string, nowIso: string): SessionRecord | null {
    const row = this.db
      .prepare(`
        SELECT * FROM sessions
        WHERE id = ?
          AND expires_at > ?
      `)
      .get(id, nowIso) as SessionRow | undefined;

    if (!row) {
      return null;
    }

    return mapSession(row);
  }

  delete(id: string): void {
    this.db
      .prepare(`
        DELETE FROM sessions
        WHERE id = ?
      `)
      .run(id);
  }

  deleteExpired(nowIso: string): number {
    const result = this.db
      .prepare(`
        DELETE FROM sessions
        WHERE expires_at <= ?
      `)
      .run(nowIso);

    return result.changes;
  }
}
