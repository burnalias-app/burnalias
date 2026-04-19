import { Dispatch, FormEvent, SetStateAction } from "react";
import { ForwardAddressSource } from "../api";
import { Alias, AliasStatus, ConfiguredProvider, SupportedProviderDefinition } from "../api";
import { fieldClassName, panelClassName, randomAliasName } from "../lib/utils";
import { AliasCard } from "./AliasCard";
import { RefreshButton } from "./common/RefreshButton";

export type Filter = AliasStatus | "all";

export type AliasFormState = {
  providerType: "simplelogin" | "addy" | "";
  aliasFormat: string;
  domainName: string;
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
  providerAliasCounts: Record<string, number>;
  filter: Filter;
  allTabSearch: string;
  allTabSort: "created-desc" | "created-asc" | "expires-asc" | "active-first";
  error: string | null;
  loading: boolean;
  syncSubmitting: boolean;
  form: AliasFormState;
  selectedProvider: ConfiguredProvider | null;
  selectedProviderMeta: SupportedProviderDefinition | null;
  providerPreview: {
    usesTypedLocalPart?: boolean;
    aliasFormatOptions?: Array<{ value: string; label: string }>;
    domainOptions?: Array<{ value: string; label: string }>;
    maxRecipientCount?: number | null;
  };
  forwardAddresses: string[];
  forwardAddressSource: ForwardAddressSource;
  aliasPreview: string;
  createDisabledReason: string | null;
  submitting: boolean;
  onFormChange: Dispatch<SetStateAction<AliasFormState>>;
  onFilterChange: (filter: Filter) => void;
  onAllTabSearchChange: (value: string) => void;
  onAllTabSortChange: (value: "created-desc" | "created-asc" | "expires-asc" | "active-first") => void;
  onSubmit: (event: FormEvent) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onUpdateAlias: (payload: {
    id: string;
    destinationEmail: string;
    label: string | null;
    enabled: boolean;
    expiresInHours: number | null;
    clearExpiration: boolean;
  }) => Promise<void>;
  onSync: () => Promise<void>;
};

export function DashboardView({
  aliases,
  configuredProviderTypes,
  filter,
  allTabSearch,
  allTabSort,
  error,
  loading,
  syncSubmitting,
  form,
  selectedProvider,
  selectedProviderMeta,
  providerPreview,
  providerAliasCounts,
  forwardAddresses,
  forwardAddressSource,
  aliasPreview,
  createDisabledReason,
  submitting,
  onFormChange,
  onFilterChange,
  onAllTabSearchChange,
  onAllTabSortChange,
  onSubmit,
  onDelete,
  onUpdateAlias,
  onSync
}: DashboardViewProps) {
  const configuredProviderTypeSet = new Set(configuredProviderTypes);
  const usesTypedLocalPart = providerPreview.usesTypedLocalPart !== false;
  const isAddy = selectedProvider?.type === "addy";

  return (
    <div className="grid min-w-0 gap-5">
      {/* Create alias */}
      <section className={panelClassName("p-5 sm:p-6")}>
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h2 className="font-serif text-2xl text-white sm:text-3xl">Create alias</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Generate a one-word alias name, choose where it forwards, and set how long it should stay active (minimum 1 hour).
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,16rem)] sm:items-end">
            <label className="grid gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Provider</span>
              <select
                className={fieldClassName()}
                value={form.providerType}
                onChange={(e) =>
                  onFormChange((cur) => ({ ...cur, providerType: e.target.value as AliasFormState["providerType"] }))
                }
                required
              >
                {selectedProvider ? null : <option value="">Select a default provider in settings</option>}
                {(["simplelogin", "addy"] as const)
                  .filter((providerType) => configuredProviderTypeSet.has(providerType))
                  .map((providerType) => (
                    <option key={providerType} value={providerType}>
                      {providerType === "simplelogin" ? "SimpleLogin" : "Addy.io"}
                    </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <form className="grid gap-5" onSubmit={onSubmit}>
          <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {usesTypedLocalPart ? (
              <label className="grid gap-2">
                <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  <span>Alias name</span>
                  <RefreshButton
                    loading={false}
                    onClick={() => onFormChange((cur) => ({ ...cur, localPart: randomAliasName() }))}
                    label="Regenerate alias name"
                  />
                </span>
                <input
                  className={fieldClassName()}
                  value={form.localPart}
                  onChange={(e) => onFormChange((cur) => ({ ...cur, localPart: e.target.value }))}
                  placeholder="cedar"
                  required
                />
              </label>
            ) : null}
            {isAddy && providerPreview.aliasFormatOptions && providerPreview.aliasFormatOptions.length > 0 ? (
              <label className="grid gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Alias format</span>
                <select
                  className={fieldClassName()}
                  value={form.aliasFormat}
                  onChange={(e) => onFormChange((cur) => ({ ...cur, aliasFormat: e.target.value }))}
                >
                  {providerPreview.aliasFormatOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {isAddy && providerPreview.domainOptions && providerPreview.domainOptions.length > 0 ? (
              <label className="grid gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Domain</span>
                <select
                  className={fieldClassName()}
                  value={form.domainName}
                  onChange={(e) => onFormChange((cur) => ({ ...cur, domainName: e.target.value }))}
                >
                  {providerPreview.domainOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
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
                  <option value="">No verified forward targets available</option>
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

          {isAddy && providerPreview.maxRecipientCount === 1 ? (
            <p className="text-xs leading-5 text-slate-400">
              Addy.io free plans allow one recipient mailbox per alias.
            </p>
          ) : null}

          <div className="grid min-w-0 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <section className={panelClassName("min-w-0 p-4 sm:p-5")}>
              <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Alias preview</span>
              <p className="mt-3 wrap-break-word font-mono text-base text-white sm:text-lg">{aliasPreview}</p>
              <p className="mt-3 text-sm leading-6 text-slate-400">
                {usesTypedLocalPart
                  ? "BurnAlias builds the full alias using the selected provider domain, then starts the expiration countdown from the moment the alias is created."
                  : "The provider will generate the local part for this alias when it is created. BurnAlias can only preview the format, not the exact generated value."}
              </p>
            </section>
            <section className={panelClassName("min-w-0 p-4 sm:p-5")}>
              <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Provider</span>
              <p className="mt-3 text-lg text-white">{selectedProvider?.name ?? "No default provider"}</p>
              {selectedProvider ? (
                <p className="mt-2 text-sm text-slate-400">
                  {providerAliasCounts[selectedProvider.type] ?? 0} live aliases
                </p>
              ) : null}
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
              {createDisabledReason ??
                (usesTypedLocalPart
                  ? "The alias name is generated for you, but you can override it before creation. Expiration is measured from the moment the alias is created."
                  : "The provider will generate the alias local part when it creates the alias. Expiration is measured from the moment the alias is created.")}
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
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <h2 className="font-serif text-2xl text-white sm:text-3xl">Alias listing</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">Filter aliases by lifecycle state and manage them in place.</p>
          </div>
        </div>

        <div className="mb-5 grid gap-3 xl:grid-cols-[minmax(0,1fr)_15rem_24rem] xl:items-end">
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
          <label className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Sort</span>
            <select
              className={fieldClassName()}
              value={allTabSort}
              onChange={(e) => onAllTabSortChange(e.target.value as DashboardViewProps["allTabSort"])}
            >
              {filter === "all" ? <option value="active-first">Active first</option> : null}
              <option value="created-desc">Newest created</option>
              <option value="created-asc">Oldest created</option>
              <option value="expires-asc">Expires soonest</option>
            </select>
          </label>
          <label className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Search</span>
            <input
              className={fieldClassName()}
              value={allTabSearch}
              onChange={(e) => onAllTabSearchChange(e.target.value)}
              placeholder="Search aliases, labels, providers, or targets"
            />
          </label>
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
                onDelete={onDelete}
                forwardAddresses={forwardAddresses}
                onUpdateAlias={onUpdateAlias}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
