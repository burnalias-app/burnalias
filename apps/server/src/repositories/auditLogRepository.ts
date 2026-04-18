import Database from "better-sqlite3";
import { createId } from "../lib/id";

export interface AuditLog {
  id: string;
  aliasId: string;
  eventType: string;
  message: string;
  createdAt: string;
}

export interface AuditHistoryEntry extends AuditLog {
  aliasEmail: string | null;
}

export class AuditLogRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: Omit<AuditLog, "id" | "createdAt">): AuditLog {
    const record: AuditLog = {
      id: createId(),
      aliasId: input.aliasId,
      eventType: input.eventType,
      message: input.message,
      createdAt: new Date().toISOString()
    };

    this.db
      .prepare(`
        INSERT INTO audit_logs (id, alias_id, event_type, message, created_at)
        VALUES (@id, @aliasId, @eventType, @message, @createdAt)
      `)
      .run(record);

    return record;
  }

  listForAlias(aliasId: string): AuditLog[] {
    return this.db
      .prepare(`
        SELECT
          id,
          alias_id as aliasId,
          event_type as eventType,
          message,
          created_at as createdAt
        FROM audit_logs
        WHERE alias_id = ?
        ORDER BY created_at DESC
      `)
      .all(aliasId) as AuditLog[];
  }

  listRecent(limit = 100): AuditHistoryEntry[] {
    return this.db
      .prepare(`
        SELECT
          audit_logs.id as id,
          audit_logs.alias_id as aliasId,
          audit_logs.event_type as eventType,
          audit_logs.message as message,
          audit_logs.created_at as createdAt,
          aliases.email as aliasEmail
        FROM audit_logs
        LEFT JOIN aliases ON aliases.id = audit_logs.alias_id
        ORDER BY audit_logs.created_at DESC
        LIMIT ?
      `)
      .all(limit) as AuditHistoryEntry[];
  }

  deleteForAlias(aliasId: string): void {
    this.db
      .prepare(`
        DELETE FROM audit_logs
        WHERE alias_id = ?
      `)
      .run(aliasId);
  }
}
