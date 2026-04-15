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
    this.db
      .prepare(`
        INSERT INTO aliases (
          id, email, provider_name, provider_alias_id, destination_email, created_at, expires_at, status, label
        ) VALUES (
          @id, @email, @providerName, @providerAliasId, @destinationEmail, @createdAt, @expiresAt, @status, @label
        )
      `)
      .run(alias);

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

  findById(id: string): Alias | null {
    const row = this.db
      .prepare(`
        SELECT * FROM aliases
        WHERE id = ?
      `)
      .get(id) as AliasRow | undefined;

    return row ? mapAlias(row) : null;
  }

  updateStatus(id: string, status: AliasStatus): void {
    this.db
      .prepare(`
        UPDATE aliases
        SET status = ?
        WHERE id = ?
      `)
      .run(status, id);
  }

  delete(id: string): void {
    this.db
      .prepare(`
        DELETE FROM aliases
        WHERE id = ?
      `)
      .run(id);
  }

  listExpiredActive(nowIso: string): Alias[] {
    return this.db
      .prepare(`
        SELECT * FROM aliases
        WHERE status = 'active'
          AND expires_at IS NOT NULL
          AND expires_at <= ?
        ORDER BY expires_at ASC
      `)
      .all(nowIso)
      .map((row: unknown) => mapAlias(row as AliasRow));
  }
}
