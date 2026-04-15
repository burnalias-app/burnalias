import { Alias } from "../api";
import { formatDate, getCountdown, panelClassName } from "../lib/utils";

type AliasCardProps = {
  alias: Alias;
  onToggle: (alias: Alias) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

const statusStyles: Record<Alias["status"], string> = {
  active: "bg-emerald-500/15 text-emerald-200",
  disabled: "bg-slate-500/20 text-slate-200",
  expired: "bg-[#d7a968]/18 text-[#edd3a7]"
};

export function AliasCard({ alias, onToggle, onDelete }: AliasCardProps) {
  return (
    <article className={panelClassName("p-5")}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="truncate font-serif text-xl text-white">{alias.email}</h3>
          <p className="mt-1 wrap-break-word text-sm leading-6 text-slate-300">{alias.destinationEmail}</p>
        </div>
        <span className={["inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold capitalize", statusStyles[alias.status]].join(" ")}>
          {alias.status}
        </span>
      </div>

      <dl className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Provider</dt>
          <dd className="mt-1 text-sm text-slate-200">{alias.providerName}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Label</dt>
          <dd className="mt-1 text-sm text-slate-200">{alias.label ?? "None"}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Created</dt>
          <dd className="mt-1 text-sm text-slate-200">{formatDate(alias.createdAt)}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Expires</dt>
          <dd className="mt-1 text-sm text-slate-200">{formatDate(alias.expiresAt)}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Countdown</dt>
          <dd className="mt-1 text-sm text-slate-200">{getCountdown(alias.expiresAt)}</dd>
        </div>
      </dl>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          className="rounded-[1.1rem] border border-white/10 bg-[#141b24]/88 px-4 py-3 text-sm font-medium text-white transition hover:bg-[#1b2430]"
          onClick={() => void onToggle(alias)}
        >
          {alias.status === "active" ? "Disable" : "Enable"}
        </button>
        <button
          type="button"
          className="rounded-[1.1rem] border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-200 transition hover:bg-red-500/15"
          onClick={() => void onDelete(alias.id)}
        >
          Delete
        </button>
      </div>
    </article>
  );
}
