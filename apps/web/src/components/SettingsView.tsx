import { useEffect, useState } from "react";
import {
  ConfiguredProvider,
  ForwardAddressSource,
  ProviderType,
  SupportedProviderDefinition
} from "../api";
import { fieldClassName, panelClassName } from "../lib/utils";
import { RefreshButton } from "./common/RefreshButton";
import { ProviderCard } from "./ProviderCard";

export type SettingsFormState = {
  providers: ConfiguredProvider[];
  activeProviderId: string | null;
  historyRetentionDays: string;
};

type SettingsViewProps = {
  settingsForm: SettingsFormState;
  supportedProviders: SupportedProviderDefinition[];
  providerAliasCounts: Record<string, number>;
  settingsError: string | null;
  savingSection: "provider" | "history-retention" | null;
  forwardTargetsLoading: boolean;
  providerForwardAddressStates: Partial<Record<ProviderType, {
    forwardAddresses: string[];
    source: ForwardAddressSource;
    providerName: string | null;
  }>>;
  onSetActive: (providerId: string) => void;
  onSetActiveBlocked: (message: string) => void;
  onRenameProvider: (providerId: string, name: string) => void;
  onSecretChange: (providerId: string, value: string) => void;
  onClearSecret: (providerId: string) => void;
  onConnectionTestSuccess: (
    providerId: string,
    testedAt: string,
    verificationToken: string,
    capabilities?: {
      supportsCustomAliases?: boolean;
      defaultAliasDomain?: string | null;
      defaultAliasFormat?: string | null;
      domainOptions?: string[];
      maxRecipientCount?: number | null;
    }
  ) => void;
  onHistoryRetentionDaysChange: (value: string) => void;
  onRefreshForwardTargets: () => Promise<void>;
  onSaveProvider: (providerId: string) => Promise<void>;
  onSaveHistoryRetention: () => Promise<void>;
};

export function SettingsView({
  settingsForm,
  supportedProviders,
  providerAliasCounts,
  settingsError,
  savingSection,
  forwardTargetsLoading,
  providerForwardAddressStates,
  onSetActive,
  onSetActiveBlocked,
  onRenameProvider,
  onSecretChange,
  onClearSecret,
  onConnectionTestSuccess,
  onHistoryRetentionDaysChange,
  onRefreshForwardTargets,
  onSaveProvider,
  onSaveHistoryRetention
}: SettingsViewProps) {
  const [selectedProviderType, setSelectedProviderType] = useState<ProviderType>(
    settingsForm.providers.find((provider) => provider.id === settingsForm.activeProviderId)?.type ?? "simplelogin"
  );

  useEffect(() => {
    if (!settingsForm.providers.some((provider) => provider.type === selectedProviderType)) {
      setSelectedProviderType(settingsForm.providers[0]?.type ?? "simplelogin");
    }
  }, [selectedProviderType, settingsForm.providers]);

  function isProviderReady(provider: ConfiguredProvider): boolean {
    return Boolean(provider.config.hasStoredSecret) && Boolean(provider.config.lastConnectionTestSucceededAt);
  }

  const selectedProvider =
    settingsForm.providers.find((provider) => provider.type === selectedProviderType) ?? settingsForm.providers[0];
  const selectedProviderMeta = supportedProviders.find((item) => item.type === selectedProvider?.type);
  const setActiveDisabledReason =
    !selectedProvider
      ? "No provider is available to select."
      : !selectedProviderMeta?.implemented
        ? `${selectedProviderMeta?.label ?? selectedProvider.name} is not implemented yet.`
        : !isProviderReady(selectedProvider)
          ? "Complete provider setup and run a successful connection test before setting it as the default."
          : null;

  return (
    <section className={panelClassName("p-5 sm:p-6")}>
      <div className="mb-6">
        <h2 className="font-serif text-2xl text-white sm:text-3xl">Settings</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Configure providers, choose which one BurnAlias should use by default for new aliases, and review the verified forward targets available right now.
        </p>
      </div>

      <div className="grid gap-5">
        <div className="grid gap-5 xl:grid-cols-[1.25fr_0.95fr]">
          {/* Providers */}
          <section className={panelClassName("p-5")}>
            <h3 className="font-serif text-xl text-white">Providers</h3>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Configure each supported provider here, then choose which ready provider BurnAlias should use by default for alias creation.
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              {supportedProviders.map((provider) => {
                const configuredProvider = settingsForm.providers.find((item) => item.type === provider.type);
                const isSelected = selectedProviderType === provider.type;
                const isChosen = settingsForm.activeProviderId === configuredProvider?.id;
                return (
                  <button
                    key={provider.type}
                    type="button"
                    className={[
                      "rounded-full border px-4 py-2 text-sm transition",
                      isSelected
                        ? "border-[#d7a968]/40 bg-[#d7a968]/12 text-[#f0d8b0]"
                        : "border-white/10 bg-[#141b24]/88 text-slate-200 hover:bg-[#1b2430]"
                    ].join(" ")}
                    onClick={() => setSelectedProviderType(provider.type)}
                  >
                    <span className="flex items-center gap-2">
                      <span>{provider.label}</span>
                      {isChosen ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/20 bg-emerald-500/12 px-2 py-0.5 text-[11px] font-semibold text-emerald-200">
                          <svg
                            className="h-3.5 w-3.5"
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
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-5 grid gap-4">
              {!selectedProvider ? (
                <div className="rounded-[1.1rem] border border-white/10 bg-[#141b24]/85 px-4 py-5 text-sm text-slate-300">
                  No provider is available to configure.
                </div>
              ) : (
                <ProviderCard
                  provider={selectedProvider}
                  isActive={settingsForm.activeProviderId === selectedProvider.id}
                  meta={selectedProviderMeta}
                  supportedProviders={supportedProviders}
                  aliasCount={providerAliasCounts[selectedProvider.type] ?? 0}
                  canSetActive={!setActiveDisabledReason}
                  setActiveDisabledReason={setActiveDisabledReason}
                  saving={savingSection === "provider"}
                  onSetActive={onSetActive}
                  onSetActiveBlocked={onSetActiveBlocked}
                  onRename={onRenameProvider}
                  onSecretChange={onSecretChange}
                  onClearSecret={onClearSecret}
                  onConnectionTestSuccess={onConnectionTestSuccess}
                  onSave={onSaveProvider}
                />
              )}
            </div>
          </section>

          {/* Right column */}
          <section className="grid gap-5">
            <section className={panelClassName("p-5")}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="font-serif text-xl text-white">Verified forward targets</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    BurnAlias reads these mailboxes from every configured provider and uses the selected provider targets in the alias composer.
                  </p>
                </div>
                <RefreshButton
                  loading={forwardTargetsLoading}
                  onClick={() => void onRefreshForwardTargets()}
                  label="Refresh forward targets"
                  disabled={!settingsForm.activeProviderId}
                />
              </div>

              <div className="mt-5 grid gap-4">
                {settingsForm.providers.map((provider) => {
                  const forwardState = providerForwardAddressStates[provider.type];
                  const forwardAddresses = forwardState?.forwardAddresses ?? [];
                  const hasProviderTargets = forwardState?.source === "provider";

                  return (
                    <div
                      key={provider.id}
                      className="rounded-[1.1rem] border border-white/10 bg-[#141b24]/85 px-4 py-4"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                            Provider
                          </span>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <p className="text-base text-white">
                              {forwardState?.providerName ?? provider.name}
                            </p>
                            {settingsForm.activeProviderId === provider.id ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/20 bg-emerald-500/12 px-2.5 py-1 text-xs font-semibold text-emerald-200">
                                <svg
                                  className="h-3.5 w-3.5"
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
                                Default
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      {!hasProviderTargets ? (
                        <p className="mt-4 text-sm leading-6 text-slate-300">
                          No verified forward targets are currently available from this provider.
                        </p>
                      ) : null}

                      {forwardAddresses.length > 0 ? (
                        <ul className="mt-4 grid gap-2">
                          {forwardAddresses.map((address) => (
                            <li
                              key={`${provider.id}-${address}`}
                              className="rounded-[0.95rem] border border-white/8 bg-[#111820]/80 px-3 py-2 text-sm text-slate-100 break-words"
                            >
                              {address}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-4 text-sm text-slate-400">
                          Refresh targets after adding or verifying new mailboxes with the provider.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className={panelClassName("p-5")}>
              <h3 className="font-serif text-xl text-white">History retention</h3>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Expired and deleted aliases stay in BurnAlias for history, then are purged automatically.
              </p>
              <div className="mt-5 grid gap-2">
                <label className="grid gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Purge terminal aliases after</span>
                  <div className="flex items-center gap-2">
                    <input
                      className={`${fieldClassName()} min-w-0`}
                      type="number"
                      min="1"
                      step="1"
                      inputMode="numeric"
                      value={settingsForm.historyRetentionDays}
                      onChange={(e) => onHistoryRetentionDaysChange(e.target.value)}
                      required
                    />
                    <span className="text-sm text-slate-300">days</span>
                  </div>
                </label>
              </div>
              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  className="rounded-[1.1rem] bg-linear-to-r from-[#c7924a] to-[#e0b777] px-4 py-2.5 text-sm font-semibold text-[#11161d] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => void onSaveHistoryRetention()}
                  disabled={savingSection === "history-retention"}
                >
                  {savingSection === "history-retention" ? "Saving..." : "Save retention"}
                </button>
              </div>
            </section>
          </section>
        </div>

        {settingsError ? (
          <div className="rounded-[1.1rem] border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {settingsError}
          </div>
        ) : null}

      </div>
    </section>
  );
}
