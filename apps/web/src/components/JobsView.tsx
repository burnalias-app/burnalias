import { SchedulerJob } from "../api";
import { formatDate, formatInterval, panelClassName } from "../lib/utils";

type JobsViewProps = {
  jobs: SchedulerJob[];
  loading: boolean;
  error: string | null;
  runningJobId: string | null;
  onRunJob: (jobId: SchedulerJob["id"]) => Promise<void>;
};

const outcomeStyles: Record<SchedulerJob["lastOutcome"], string> = {
  idle: "bg-slate-500/20 text-slate-200",
  success: "bg-emerald-500/15 text-emerald-200",
  error: "bg-red-500/12 text-red-200"
};

export function JobsView({ jobs, loading, error, runningJobId, onRunJob }: JobsViewProps) {
  return (
    <section className={panelClassName("p-5 sm:p-6")}>
      <div className="mb-6">
        <h2 className="font-serif text-2xl text-white sm:text-3xl">Jobs</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Track lifecycle and synchronization tasks, see when they last ran, and trigger them manually when needed.
        </p>
      </div>

      {error ? (
        <div className="mb-4 rounded-[1.1rem] border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-[1.1rem] border border-white/10 bg-[#141b24]/85 px-4 py-8 text-center text-slate-300">
          Loading jobs...
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {jobs.map((job) => {
            const isRunning = runningJobId === job.id || job.isRunning;
            return (
              <article key={job.id} className={panelClassName("p-5")}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-serif text-xl text-white">{job.title}</h3>
                      <span
                        className={[
                          "inline-flex rounded-full px-3 py-1 text-xs font-semibold capitalize",
                          outcomeStyles[job.lastOutcome]
                        ].join(" ")}
                      >
                        {job.lastOutcome}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-300">{job.description}</p>
                  </div>

                  <button
                    type="button"
                    className="rounded-[1.1rem] border border-white/10 bg-[#141b24]/88 px-4 py-3 text-sm font-medium text-white transition hover:bg-[#1b2430] disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => void onRunJob(job.id)}
                    disabled={isRunning}
                  >
                    {isRunning ? "Running..." : "Run now"}
                  </button>
                </div>

                <dl className="mt-5 grid gap-4 sm:grid-cols-2">
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Interval</dt>
                    <dd className="mt-1 text-sm text-slate-200">{formatInterval(job.intervalMs)}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Next run</dt>
                    <dd className="mt-1 text-sm text-slate-200">{formatDate(job.nextRunAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Last started</dt>
                    <dd className="mt-1 text-sm text-slate-200">{formatDate(job.lastStartedAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Last finished</dt>
                    <dd className="mt-1 text-sm text-slate-200">{formatDate(job.lastFinishedAt)}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Last summary</dt>
                    <dd className="mt-1 text-sm text-slate-200">{job.lastSummary ?? "No runs recorded yet."}</dd>
                  </div>
                </dl>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
