import { useState } from "react";
import { Alias } from "../api";
import { formatDate, getCountdown, panelClassName } from "../lib/utils";
import { Modal } from "./Modal";

type AliasCardProps = {
  alias: Alias;
  providerRemovedFromApp?: boolean;
  forwardAddresses: string[];
  onDelete: (id: string) => Promise<void>;
  onUpdateAlias: (payload: {
    id: string;
    destinationEmail: string;
    label: string | null;
    enabled: boolean;
    expiresInHours: number | null;
    clearExpiration: boolean;
  }) => Promise<void>;
};

const statusStyles: Record<Alias["status"], string> = {
  active: "bg-emerald-500/15 text-emerald-200",
  inactive: "bg-slate-500/20 text-slate-200",
  expired: "bg-[#d7a968]/18 text-[#edd3a7]",
  deleted: "bg-red-500/12 text-red-200"
};

export function AliasCard({
  alias,
  providerRemovedFromApp = false,
  forwardAddresses,
  onDelete,
  onUpdateAlias
}: AliasCardProps) {
  const isTerminal = alias.status === "expired" || alias.status === "deleted";
  const expirationLabel = alias.status === "expired" ? "Expired" : "Expires";
  const [editingAlias, setEditingAlias] = useState(false);
  const [expAmount, setExpAmount] = useState("30");
  const [expUnit, setExpUnit] = useState<"h" | "d">("d");
  const [editDestinationEmail, setEditDestinationEmail] = useState(alias.destinationEmail);
  const [editLabel, setEditLabel] = useState(alias.label ?? "");
  const [editEnabled, setEditEnabled] = useState(alias.status === "active");
  const [saving, setSaving] = useState(false);

  function openEditModal() {
    setEditDestinationEmail(alias.destinationEmail);
    setEditLabel(alias.label ?? "");
    setEditEnabled(alias.status === "active");
    setExpAmount("");
    setExpUnit("d");
    setEditingAlias(true);
  }

  async function handleSaveAlias() {
    if (!editDestinationEmail) return;
    setSaving(true);
    try {
      const expiresInHours =
        !expAmount.trim()
          ? null
          : expUnit === "d"
            ? Number(expAmount) * 24
            : Number(expAmount);

      await onUpdateAlias({
        id: alias.id,
        destinationEmail: editDestinationEmail,
        label: editLabel.trim() ? editLabel.trim() : null,
        enabled: editEnabled,
        expiresInHours,
        clearExpiration: false
      });
      setEditingAlias(false);
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
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{expirationLabel}</span>
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
              onClick={openEditModal}
            >
              Edit
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

      {editingAlias ? (
        <Modal title="Edit alias" onClose={() => setEditingAlias(false)}>
          <p className="mb-4 wrap-break-word text-sm text-slate-400">{alias.email}</p>

          <div className="grid gap-4">
            <label className="flex items-center justify-between gap-4 rounded-[1.1rem] border border-white/10 bg-[#141b24]/88 px-4 py-3">
              <div>
                <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Alias status</span>
                <span className="mt-1 block text-sm text-slate-300">{editEnabled ? "Active and forwarding" : "Inactive and paused"}</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={editEnabled}
                onClick={() => setEditEnabled((cur) => !cur)}
                className={[
                  "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition",
                  editEnabled ? "bg-emerald-500/80" : "bg-slate-600/80"
                ].join(" ")}
              >
                <span
                  className={[
                    "inline-block h-5 w-5 rounded-full bg-white transition",
                    editEnabled ? "translate-x-6" : "translate-x-1"
                  ].join(" ")}
                />
              </button>
            </label>

            <label className="grid gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Forward to</span>
              <select
                className="rounded-[1.1rem] border border-white/10 bg-[#141b24] px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-[#d7a968]/50 focus:ring-2 focus:ring-[#d7a968]/20 disabled:opacity-50"
                value={editDestinationEmail}
                onChange={(e) => setEditDestinationEmail(e.target.value)}
                disabled={forwardAddresses.length === 0}
              >
                {forwardAddresses.map((address) => (
                  <option key={address} value={address}>
                    {address}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Label</span>
              <input
                className="rounded-[1.1rem] border border-white/10 bg-[#141b24] px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-[#d7a968]/50 focus:ring-2 focus:ring-[#d7a968]/20"
                value={editLabel}
                onChange={(e) => setEditLabel(e.target.value)}
                placeholder="shopping"
                autoFocus
              />
            </label>

            <div className="grid gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Expiration</span>
              <div className="flex gap-2">
                <input
                  className="min-w-0 rounded-[1.1rem] border border-white/10 bg-[#141b24] px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-[#d7a968]/50 focus:ring-2 focus:ring-[#d7a968]/20 disabled:opacity-50"
                  type="number"
                  min="1"
                  step="1"
                  value={expAmount}
                  onChange={(e) => setExpAmount(e.target.value)}
                  autoFocus
                />
                <select
                  className="w-24 shrink-0 rounded-[1.1rem] border border-white/10 bg-[#141b24] px-3 py-3 text-sm text-slate-100 outline-none transition focus:border-[#d7a968]/50 disabled:opacity-50"
                  value={expUnit}
                  onChange={(e) => setExpUnit(e.target.value as "h" | "d")}
                >
                  <option value="h">hours</option>
                  <option value="d">days</option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={saving || forwardAddresses.length === 0}
                onClick={() => void handleSaveAlias()}
                className="rounded-[1.1rem] bg-linear-to-r from-[#c7924a] to-[#e0b777] px-5 py-2.5 text-sm font-semibold text-[#11161d] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => setEditingAlias(false)}
                className="rounded-[1.1rem] border border-white/10 bg-[#141b24]/88 px-5 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-[#1b2430] disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
