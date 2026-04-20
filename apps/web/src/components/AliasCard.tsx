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

function renderBreakableAddress(value: string) {
  return value.split(/([@._-])/).map((segment, index) => (
    <span key={`${segment}-${index}`}>
      {segment}
      {segment === "@" || segment === "." || segment === "_" || segment === "-" ? <wbr /> : null}
    </span>
  ));
}

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
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [copied, setCopied] = useState(false);

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

  async function handleDeleteClick() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }

    await onDelete(alias.id);
  }

  async function handleCopyAlias() {
    await navigator.clipboard.writeText(alias.email);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <>
      <article className={panelClassName("min-w-0 p-4 sm:p-5")}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex min-w-0 items-start gap-2">
              <h3 className="min-w-0 font-serif text-lg text-white sm:text-xl">{renderBreakableAddress(alias.email)}</h3>
              <button
                type="button"
                onClick={() => void handleCopyAlias()}
                className="mt-0.5 inline-flex h-8 w-8 shrink-0 self-start items-center justify-center rounded-full text-zinc-400 transition hover:text-zinc-200"
                aria-label={copied ? "Alias copied" : "Copy alias"}
                title={copied ? "Alias copied" : "Copy alias"}
              >
                {copied ? (
                  <svg
                    className="h-4 w-4"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                ) : (
                  <svg
                    className="h-4 w-4"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                )}
              </button>
            </div>
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
            <dd className="mt-1 text-sm text-slate-200">{renderBreakableAddress(alias.destinationEmail)}</dd>
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
              className={[
                "w-full rounded-[1.1rem] px-4 py-3 text-sm font-medium transition sm:w-auto",
                confirmingDelete
                  ? "border border-red-300/35 bg-red-500/20 text-red-100 hover:bg-red-500/25"
                  : "border border-red-400/20 bg-red-500/10 text-red-200 hover:bg-red-500/15"
              ].join(" ")}
              onClick={() => void handleDeleteClick()}
            >
              {confirmingDelete ? "Are you sure?" : "Delete"}
            </button>
            {confirmingDelete ? (
              <button
                type="button"
                className="w-full rounded-[1.1rem] border border-white/10 bg-[#141b24]/88 px-4 py-3 text-sm font-medium text-slate-300 transition hover:bg-[#1b2430] sm:w-auto"
                onClick={() => setConfirmingDelete(false)}
              >
                Cancel
              </button>
            ) : null}
          </div>
        ) : providerRemovedFromApp ? (
          <div className="mt-5 rounded-[1rem] border border-amber-400/20 bg-amber-500/8 px-4 py-3 text-sm leading-6 text-amber-100/90">
            This alias is kept for historical reference. Its original provider has been removed from BurnAlias.
          </div>
        ) : null}
      </article>

      {editingAlias ? (
        <Modal title="Edit alias" onClose={() => setEditingAlias(false)}>
          <p className="mb-4 text-sm text-slate-400">{renderBreakableAddress(alias.email)}</p>

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
