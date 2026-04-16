import { useState } from "react";
import { Alias } from "../api";
import { formatDate, getCountdown, panelClassName } from "../lib/utils";
import { Modal } from "./Modal";

type AliasCardProps = {
  alias: Alias;
  providerRemovedFromApp?: boolean;
  onToggle: (alias: Alias) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onUpdateExpiration: (id: string, expiresInHours: number | null) => Promise<void>;
};

const statusStyles: Record<Alias["status"], string> = {
  active: "bg-emerald-500/15 text-emerald-200",
  inactive: "bg-slate-500/20 text-slate-200",
  expired: "bg-[#d7a968]/18 text-[#edd3a7]",
  deleted: "bg-red-500/12 text-red-200"
};

export function AliasCard({ alias, providerRemovedFromApp = false, onToggle, onDelete, onUpdateExpiration }: AliasCardProps) {
  const isTerminal = alias.status === "expired" || alias.status === "deleted";
  const [editingExpiration, setEditingExpiration] = useState(false);
  const [expAmount, setExpAmount] = useState("30");
  const [expUnit, setExpUnit] = useState<"h" | "d">("d");
  const [saving, setSaving] = useState(false);

  function openExpirationModal() {
    setExpAmount("30");
    setExpUnit("d");
    setEditingExpiration(true);
  }

  async function handleSaveExpiration() {
    const hours = expUnit === "d" ? Number(expAmount) * 24 : Number(expAmount);
    if (!hours || hours < 1) return;
    setSaving(true);
    try {
      await onUpdateExpiration(alias.id, hours);
      setEditingExpiration(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleClearExpiration() {
    setSaving(true);
    try {
      await onUpdateExpiration(alias.id, null);
      setEditingExpiration(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <article className={panelClassName("min-w-0 p-4 sm:p-5")}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h3 className="break-words font-serif text-lg text-white sm:text-xl">{alias.email}</h3>
          </div>
          <span className={["inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold capitalize", statusStyles[alias.status]].join(" ")}>
            {alias.status}
          </span>
        </div>

        <dl className="mt-5 grid min-w-0 gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Created</dt>
            <dd className="mt-1 text-sm text-slate-200">{formatDate(alias.createdAt)}</dd>
          </div>
          <div>
            <dt className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Expires</span>
              {!isTerminal ? (
                <button
                  type="button"
                  className="text-[11px] text-[#d7a968]/80 transition hover:text-[#d7a968]"
                  onClick={openExpirationModal}
                >
                  edit
                </button>
              ) : null}
            </dt>
            <dd className="mt-1 text-sm text-slate-200">{formatDate(alias.expiresAt)}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Forwards to</dt>
            <dd className="mt-1 break-words text-sm text-slate-200">{alias.destinationEmail}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Label</dt>
            <dd className="mt-1 text-sm text-slate-200">{alias.label ?? "None"}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Countdown</dt>
            <dd className="mt-1 text-sm text-slate-200">{getCountdown(alias.expiresAt)}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Provider</dt>
            <dd className="mt-1 text-sm text-slate-200">
              {alias.providerName}
              {providerRemovedFromApp ? (
                <span className="ml-2 inline-flex rounded-full border border-amber-400/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-200">
                  Removed from BA
                </span>
              ) : null}
            </dd>
          </div>
        </dl>

        {!isTerminal ? (
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              className="w-full rounded-[1.1rem] border border-white/10 bg-[#141b24]/88 px-4 py-3 text-sm font-medium text-white transition hover:bg-[#1b2430] sm:w-auto"
              onClick={() => void onToggle(alias)}
            >
              {alias.status === "active" ? "Set inactive" : "Set active"}
            </button>
            <button
              type="button"
              className="w-full rounded-[1.1rem] border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-200 transition hover:bg-red-500/15 sm:w-auto"
              onClick={() => void onDelete(alias.id)}
            >
              Delete
            </button>
          </div>
        ) : providerRemovedFromApp ? (
          <div className="mt-5 rounded-[1rem] border border-amber-400/20 bg-amber-500/8 px-4 py-3 text-sm leading-6 text-amber-100/90">
            This alias is kept for historical reference. Its original provider has been removed from BurnAlias.
          </div>
        ) : null}
      </article>

      {editingExpiration ? (
        <Modal title="Edit expiration" onClose={() => setEditingExpiration(false)}>
          <p className="mb-4 wrap-break-word text-sm text-slate-400">{alias.email}</p>

          <div className="grid gap-4">
            <label className="grid gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">New expiration from now</span>
              <div className="flex gap-2">
                <input
                  className="min-w-0 rounded-[1.1rem] border border-white/10 bg-[#141b24] px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-[#d7a968]/50 focus:ring-2 focus:ring-[#d7a968]/20"
                  type="number"
                  min="1"
                  step="1"
                  value={expAmount}
                  onChange={(e) => setExpAmount(e.target.value)}
                  autoFocus
                />
                <select
                  className="w-24 shrink-0 rounded-[1.1rem] border border-white/10 bg-[#141b24] px-3 py-3 text-sm text-slate-100 outline-none transition focus:border-[#d7a968]/50"
                  value={expUnit}
                  onChange={(e) => setExpUnit(e.target.value as "h" | "d")}
                >
                  <option value="h">hours</option>
                  <option value="d">days</option>
                </select>
              </div>
            </label>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSaveExpiration()}
                className="rounded-[1.1rem] bg-linear-to-r from-[#c7924a] to-[#e0b777] px-5 py-2.5 text-sm font-semibold text-[#11161d] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => setEditingExpiration(false)}
                className="rounded-[1.1rem] border border-white/10 bg-[#141b24]/88 px-5 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-[#1b2430] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleClearExpiration()}
                className="rounded-[1.1rem] border border-red-400/20 bg-red-500/10 px-5 py-2.5 text-sm font-medium text-red-200 transition hover:bg-red-500/15 disabled:opacity-50"
              >
                Clear expiration
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
