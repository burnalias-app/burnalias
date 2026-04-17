import { Dispatch, FormEvent, SetStateAction } from "react";
import { ForwardAddressSource } from "../api";
import { Alias, AliasStatus, ConfiguredProvider, SupportedProviderDefinition } from "../api";
import { fieldClassName, panelClassName, randomAliasName } from "../lib/utils";
import { AliasCard } from "./AliasCard";
import { RefreshButton } from "./common/RefreshButton";

export type Filter = AliasStatus | "all";

export type AliasFormState = {
  localPart: string;
  destinationEmail: string;
  expiresAmount: string;
  expiresUnit: "h" | "d";
  label: string;
};

const filterOptions: Filter[] = ["all", "active", "inactive", "expired", "deleted"];

type DashboardViewProps = {
  aliases: Alias[];
  configuredProviderTypes: string[];
  filter: Filter;
  error: string | null;
  loading: boolean;
  syncSubmitting: boolean;
  form: AliasFormState;
  activeProvider: ConfiguredProvider | null;
  activeProviderMeta: SupportedProviderDefinition | null;
  forwardAddresses: string[];
  forwardAddressSource: ForwardAddressSource;
  aliasPreview: string;
  createDisabledReason: string | null;
  submitting: boolean;
  onFormChange: Dispatch<SetStateAction<AliasFormState>>;
  onFilterChange: (filter: Filter) => void;
  onSubmit: (event: FormEvent) => Promise<void>;
  onToggle: (alias: Alias) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onUpdateExpiration: (id: string, expiresInHours: number | null) => Promise<void>;
  onSync: () => Promise<void>;
};

export function DashboardView({
  aliases,
  configuredProviderTypes,
  filter,
  error,
  loading,
  syncSubmitting,
  form,
  activeProvider,
  activeProviderMeta,
  forwardAddresses,
  forwardAddressSource,
  aliasPreview,
  createDisabledReason,
  submitting,
  onFormChange,
  onFilterChange,
  onSubmit,
  onToggle,
  onDelete,
  onUpdateExpiration,
  onSync
}: DashboardViewProps) {
  const configuredProviderTypeSet = new Set(configuredProviderTypes);

  return (
    <div className="grid min-w-0 gap-5">
      {/* Create alias */}
      <section className={panelClassName("p-5 sm:p-6")}>
        <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h2 className="font-serif text-2xl text-white sm:text-3xl">Create alias</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Generate a one-word alias name, choose where it forwards, and set how long it should stay active (minimum 1 hour).
            </p>
          </div>
          <button
            type="button"
            className="w-full rounded-[1.1rem] border border-white/10 bg-[#141b24]/88 px-4 py-3 text-sm font-medium text-white transition hover:bg-[#1b2430] sm:w-auto"
            onClick={() => onFormChange((cur) => ({ ...cur, localPart: randomAliasName() }))}
          >
            Regenerate name
          </button>
        </div>

        <form className="grid gap-5" onSubmit={onSubmit}>
          <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <label className="grid gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Alias name</span>
              <input
                className={fieldClassName()}
                value={form.localPart}
                onChange={(e) => onFormChange((cur) => ({ ...cur, localPart: e.target.value }))}
                placeholder="cedar"
                required
              />
            </label>
            <label className="grid gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Forward to</span>
              <select
                className={fieldClassName()}
                value={form.destinationEmail}
                onChange={(e) => onFormChange((cur) => ({ ...cur, destinationEmail: e.target.value }))}
                required
                disabled={forwardAddresses.length === 0}
              >
                {forwardAddresses.length === 0 ? (
                  <option value="">Add forward-to addresses in settings</option>
                ) : null}
                {forwardAddresses.map((address) => (
                  <option key={address} value={address}>{address}</option>
                ))}
              </select>
            </label>
            <div className="grid min-w-0 gap-2 md:col-span-2 xl:col-span-1">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Expires in</span>
              <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-2">
                <input
                  className={`${fieldClassName()} min-w-0`}
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  value={form.expiresAmount}
                  onChange={(e) => onFormChange((cur) => ({ ...cur, expiresAmount: e.target.value }))}
                  placeholder="30"
                />
                <select
                  className="w-24 shrink-0 rounded-[1.1rem] border border-white/10 bg-[#141b24] px-3 py-3 text-slate-100 outline-none transition focus:border-[#d7a968]/50 focus:ring-2 focus:ring-[#d7a968]/20"
                  value={form.expiresUnit}
                  onChange={(e) => onFormChange((cur) => ({ ...cur, expiresUnit: e.target.value as "h" | "d" }))}
                >
                  <option value="h">hours</option>
                  <option value="d">days</option>
                </select>
              </div>
            </div>
          </div>

          <div className="grid min-w-0 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <section className={panelClassName("min-w-0 p-4 sm:p-5")}>
              <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Generated alias</span>
              <p className="mt-3 wrap-break-word font-mono text-base text-white sm:text-lg">{aliasPreview}</p>
              <p className="mt-3 text-sm leading-6 text-slate-400">
                BurnAlias builds the full alias using the active provider domain, then starts the expiration countdown from the moment the alias is created.
              </p>
            </section>
            <section className={panelClassName("min-w-0 p-4 sm:p-5")}>
              <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Active provider</span>
              <p className="mt-3 text-lg text-white">{activeProvider?.name ?? "No active provider"}</p>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                {activeProviderMeta?.description ?? "Choose the provider BurnAlias should use in settings."}
              </p>
            </section>
          </div>

          <label className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Label</span>
            <input
              className={fieldClassName()}
              value={form.label}
              onChange={(e) => onFormChange((cur) => ({ ...cur, label: e.target.value }))}
              placeholder="shopping"
            />
          </label>

          <div className="flex flex-col gap-4 border-t border-white/10 pt-4 md:flex-row md:items-center md:justify-between">
            <p className="max-w-2xl text-sm leading-6 text-slate-400">
              {createDisabledReason ?? "The alias name is generated for you, but you can override it before creation. Expiration is measured from the moment the alias is created."}
            </p>
            <button
              className="w-full rounded-[1.1rem] bg-linear-to-r from-[#c7924a] to-[#e0b777] px-5 py-3 font-semibold text-[#11161d] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              type="submit"
              disabled={submitting || !!createDisabledReason}
            >
              {submitting ? "Creating..." : "Create alias"}
            </button>
          </div>
        </form>
      </section>

      {/* Alias list */}
      <section className={panelClassName("min-w-0 p-5 sm:p-6")}>
        <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <h2 className="font-serif text-2xl text-white sm:text-3xl">Alias dashboard</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">Filter aliases by lifecycle state and manage them in place.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
              <RefreshButton
                loading={syncSubmitting}
                onClick={() => void onSync()}
                label="Refresh aliases"
              />
              {filterOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={[
                    "rounded-full px-4 py-2 text-sm capitalize transition",
                    option === filter
                      ? "bg-[#e7edf5] text-[#121822]"
                      : "border border-white/10 bg-[#141b24]/88 text-slate-200 hover:bg-[#1b2430]"
                  ].join(" ")}
                  onClick={() => onFilterChange(option)}
                >
                  {option}
                </button>
              ))}
          </div>
        </div>

        {error ? (
          <div className="mb-4 rounded-[1.1rem] border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-[1.1rem] border border-white/10 bg-[#141b24]/85 px-4 py-8 text-center text-slate-300">
            Loading aliases...
          </div>
        ) : aliases.length === 0 ? (
          <div className="rounded-[1.1rem] border border-white/10 bg-[#141b24]/85 px-4 py-8 text-center text-slate-300">
            No aliases found for this filter.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {aliases.map((alias) => (
              <AliasCard
                key={alias.id}
                alias={alias}
                providerRemovedFromApp={
                  (alias.status === "expired" || alias.status === "deleted") &&
                  !configuredProviderTypeSet.has(alias.providerName)
                }
                onToggle={onToggle}
                onDelete={onDelete}
                onUpdateExpiration={onUpdateExpiration}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
