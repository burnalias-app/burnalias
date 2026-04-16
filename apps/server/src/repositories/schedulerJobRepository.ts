import Database from "better-sqlite3";
import { SchedulerJobId } from "../services/expirationScheduler";

export type SchedulerJobOutcome = "idle" | "success" | "error";

export interface PersistedSchedulerJob {
  id: SchedulerJobId;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastOutcome: SchedulerJobOutcome;
  lastSummary: string | null;
}

type SchedulerJobRow = {
  id: SchedulerJobId;
  last_started_at: string | null;
  last_finished_at: string | null;
  last_outcome: SchedulerJobOutcome;
  last_summary: string | null;
};

function mapRow(row: SchedulerJobRow): PersistedSchedulerJob {
  return {
    id: row.id,
    lastStartedAt: row.last_started_at,
    lastFinishedAt: row.last_finished_at,
    lastOutcome: row.last_outcome,
    lastSummary: row.last_summary
  };
}

export class SchedulerJobRepository {
  constructor(private readonly db: Database.Database) {}

  list(): PersistedSchedulerJob[] {
    return this.db
      .prepare(`
        SELECT id, last_started_at, last_finished_at, last_outcome, last_summary
        FROM scheduler_jobs
      `)
      .all()
      .map((row: unknown) => mapRow(row as SchedulerJobRow));
  }

  upsert(job: PersistedSchedulerJob): void {
    this.db
      .prepare(`
        INSERT INTO scheduler_jobs (
          id, last_started_at, last_finished_at, last_outcome, last_summary
        ) VALUES (
          @id, @lastStartedAt, @lastFinishedAt, @lastOutcome, @lastSummary
        )
        ON CONFLICT(id) DO UPDATE SET
          last_started_at = excluded.last_started_at,
          last_finished_at = excluded.last_finished_at,
          last_outcome = excluded.last_outcome,
          last_summary = excluded.last_summary
      `)
      .run(job);
  }
}
