import Database from "better-sqlite3";
import { Alias, AliasStatus } from "../domain/alias";

type AliasRow = {
  id: string;
  email: string;
  provider_name: string;
  provider_alias_id: string;
  destination_email: string;
  created_at: string;
  expires_at: string | null;
  status: AliasStatus;
  status_changed_at: string;
  label: string | null;
};

function mapAlias(row: AliasRow): Alias {
  return {
    id: row.id,
    email: row.email,
    providerName: row.provider_name,
    providerAliasId: row.provider_alias_id,
    destinationEmail: row.destination_email,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    status: row.status,
    label: row.label
  };
}

export class AliasRepository {
  constructor(private readonly db: Database.Database) {}

  create(alias: Alias): Alias {
    const record = {
      ...alias,
      statusChangedAt: alias.createdAt
    };

    this.db
      .prepare(`
        INSERT INTO aliases (
          id, email, provider_name, provider_alias_id, destination_email, created_at, expires_at, status, status_changed_at, label
        ) VALUES (
          @id, @email, @providerName, @providerAliasId, @destinationEmail, @createdAt, @expiresAt, @status, @statusChangedAt, @label
        )
      `)
      .run(record);

    return alias;
  }

  list(status?: AliasStatus): Alias[] {
    if (status) {
      return this.db
        .prepare(`
          SELECT * FROM aliases
          WHERE status = ?
          ORDER BY created_at DESC
        `)
        .all(status)
        .map((row: unknown) => mapAlias(row as AliasRow));
    }

    return this.db
      .prepare(`
        SELECT * FROM aliases
        ORDER BY created_at DESC
      `)
      .all()
      .map((row: unknown) => mapAlias(row as AliasRow));
  }

  countNonTerminalByProviderName(providerName: string): number {
    const row = this.db
      .prepare(`
        SELECT COUNT(*) as count
        FROM aliases
        WHERE provider_name = ?
          AND status IN ('active', 'inactive')
      `)
      .get(providerName) as { count: number };

    return row.count;
  }

  findById(id: string): Alias | null {
    const row = this.db
      .prepare(`
        SELECT * FROM aliases
        WHERE id = ?
      `)
      .get(id) as AliasRow | undefined;

    return row ? mapAlias(row) : null;
  }

  updateExpiration(id: string, expiresAt: string | null): void {
    this.db
      .prepare(`
        UPDATE aliases
        SET expires_at = ?
        WHERE id = ?
      `)
      .run(expiresAt, id);
  }

  updateStatus(id: string, status: AliasStatus, statusChangedAt = new Date().toISOString()): void {
    this.db
      .prepare(`
        UPDATE aliases
        SET status = ?,
            status_changed_at = ?
        WHERE id = ?
      `)
      .run(status, statusChangedAt, id);
  }

  delete(id: string): void {
    this.db
      .prepare(`
        DELETE FROM aliases
        WHERE id = ?
      `)
      .run(id);
  }

  listExpiring(nowIso: string): Alias[] {
    return this.db
      .prepare(`
        SELECT * FROM aliases
        WHERE status IN ('active', 'inactive')
          AND expires_at IS NOT NULL
          AND expires_at <= ?
        ORDER BY expires_at ASC
      `)
      .all(nowIso)
      .map((row: unknown) => mapAlias(row as AliasRow));
  }

  listNonTerminal(): Alias[] {
    return this.db
      .prepare(`
        SELECT * FROM aliases
        WHERE status IN ('active', 'inactive')
        ORDER BY created_at DESC
      `)
      .all()
      .map((row: unknown) => mapAlias(row as AliasRow));
  }

  listTerminalBefore(cutoffIso: string): Alias[] {
    return this.db
      .prepare(`
        SELECT * FROM aliases
        WHERE status IN ('expired', 'deleted')
          AND status_changed_at <= ?
        ORDER BY status_changed_at ASC
      `)
      .all(cutoffIso)
      .map((row: unknown) => mapAlias(row as AliasRow));
  }

  listTerminalByProviderName(providerName: string): Alias[] {
    return this.db
      .prepare(`
        SELECT * FROM aliases
        WHERE provider_name = ?
          AND status IN ('expired', 'deleted')
        ORDER BY status_changed_at DESC, created_at DESC
      `)
      .all(providerName)
      .map((row: unknown) => mapAlias(row as AliasRow));
  }
}
