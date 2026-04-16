import { FormEvent } from "react";
import {
  Alias,
  ConfiguredProvider,
  ForwardAddressSource,
  ProviderType,
  SupportedProviderDefinition
} from "../api";
import { fieldClassName, panelClassName } from "../lib/utils";
import { ProviderCard } from "./ProviderCard";

export type SettingsFormState = {
  providers: ConfiguredProvider[];
  activeProviderId: string | null;
  forwardAddressesText: string;
  historyRetentionDays: string;
};

type SettingsViewProps = {
  settingsForm: SettingsFormState;
  aliases: Alias[];
  supportedProviders: SupportedProviderDefinition[];
  settingsError: string | null;
  settingsSubmitting: boolean;
  activeForwardAddressSource: ForwardAddressSource;
  activeForwardAddresses: string[];
  activeForwardAddressProviderName: string | null;
  onSubmit: (event: FormEvent) => Promise<void>;
  onAddProvider: (type: ProviderType) => void;
  onRemoveProvider: (providerId: string) => void;
  onSetActive: (providerId: string) => void;
  onRenameProvider: (providerId: string, name: string) => void;
  onApiKeyChange: (providerId: string, apiKey: string) => void;
  onClearApiKey: (providerId: string) => void;
  onConnectionTestSuccess: (providerId: string, testedAt: string, verificationToken: string) => void;
  onForwardTextChange: (value: string) => void;
  onHistoryRetentionDaysChange: (value: string) => void;
};

export function SettingsView({
  settingsForm,
  aliases,
  supportedProviders,
  settingsError,
  settingsSubmitting,
  activeForwardAddressSource,
  activeForwardAddresses,
  activeForwardAddressProviderName,
  onSubmit,
  onAddProvider,
  onRemoveProvider,
  onSetActive,
  onRenameProvider,
  onApiKeyChange,
  onClearApiKey,
  onConnectionTestSuccess,
  onForwardTextChange,
  onHistoryRetentionDaysChange
}: SettingsViewProps) {
  const activeProviderName =
    settingsForm.providers.find((p) => p.id === settingsForm.activeProviderId)?.name ?? "None selected";

  function isProviderReady(provider: ConfiguredProvider): boolean {
    if (provider.type === "simplelogin") {
      return Boolean(provider.config.hasStoredSecret) && Boolean(provider.config.lastConnectionTestSucceededAt);
    }
    return false;
  }

  return (
    <section className={panelClassName("p-5 sm:p-6")}>
      <div className="mb-6">
        <h2 className="font-serif text-2xl text-white sm:text-3xl">Settings</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Configure providers, choose the one BurnAlias should use right now, and define the forward-to targets for new aliases.
        </p>
      </div>

      <form className="grid gap-5" onSubmit={onSubmit}>
        <div className="grid gap-5 xl:grid-cols-[1.25fr_0.95fr]">
          {/* Providers */}
          <section className={panelClassName("p-5")}>
            <h3 className="font-serif text-xl text-white">Providers</h3>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Add the providers you want available in BurnAlias, then mark one configured provider as active. Alias creation always uses the active provider.
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              {supportedProviders.map((provider) => {
                const added = settingsForm.providers.some((p) => p.type === provider.type);
                return (
                  <button
                    key={provider.type}
                    type="button"
                    className="rounded-full border border-white/10 bg-[#141b24]/88 px-4 py-2 text-sm text-slate-200 transition hover:bg-[#1b2430] disabled:cursor-not-allowed disabled:opacity-45"
                    onClick={() => onAddProvider(provider.type)}
                    disabled={added}
                  >
                    {added ? `${provider.label} added` : `Add ${provider.label}`}
                  </button>
                );
              })}
            </div>

            <div className="mt-5 grid gap-4">
              {settingsForm.providers.length === 0 ? (
                <div className="rounded-[1.1rem] border border-white/10 bg-[#141b24]/85 px-4 py-5 text-sm text-slate-300">
                  No providers configured yet.
                </div>
              ) : (
                settingsForm.providers.map((provider) => (
                  (() => {
                    const isActive = settingsForm.activeProviderId === provider.id;
                    const hasAliases = aliases.some(
                      (alias) =>
                        alias.providerName === provider.type &&
                        alias.status !== "expired" &&
                        alias.status !== "deleted"
                    );
                    const anotherReadyProvider = settingsForm.providers.find(
                      (candidate) => candidate.id !== provider.id && isProviderReady(candidate)
                    );
                    const removeDisabledReason = hasAliases
                      ? "This provider cannot be removed while active or inactive aliases are still tied to it."
                      : !anotherReadyProvider
                        ? "Configure and set another tested provider as active before removing this one."
                        : isActive && settingsForm.activeProviderId !== anotherReadyProvider.id
                          ? "Set another tested provider active before removing the current one."
                          : null;
                    const canRemove = !removeDisabledReason;
                    const canSetActive = isProviderReady(provider) && (supportedProviders.find((item) => item.type === provider.type)?.implemented ?? false);

                    return (
                      <ProviderCard
                        key={provider.id}
                        provider={provider}
                        isActive={isActive}
                        meta={supportedProviders.find((item) => item.type === provider.type)}
                        supportedProviders={supportedProviders}
                        canSetActive={canSetActive}
                        canRemove={canRemove}
                        removeDisabledReason={removeDisabledReason}
                        onSetActive={onSetActive}
                        onRemove={onRemoveProvider}
                        onRename={onRenameProvider}
                        onApiKeyChange={onApiKeyChange}
                        onClearApiKey={onClearApiKey}
                        onConnectionTestSuccess={onConnectionTestSuccess}
                      />
                    );
                  })()
                ))
              )}
            </div>
          </section>

          {/* Right column */}
          <section className="grid gap-5">
            <section className={panelClassName("p-5")}>
              <h3 className="font-serif text-xl text-white">Forward targets</h3>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                The alias composer now prefers verified destinations from the active provider when they are available.
              </p>
              <div className="mt-5 grid gap-4">
                <div className="rounded-[1.1rem] border border-white/10 bg-[#141b24]/85 px-4 py-4">
                  <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    {activeForwardAddressSource === "provider" ? "Active provider targets" : "Composer source"}
                  </span>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    {activeForwardAddressSource === "provider"
                      ? `Using verified forward targets from ${activeForwardAddressProviderName ?? "the active provider"}.`
                      : activeForwardAddressSource === "settings"
                        ? "The active provider does not expose forward targets yet, so BurnAlias is using the fallback list below."
                        : "No forward targets are currently available."}
                  </p>
                  {activeForwardAddresses.length > 0 ? (
                    <ul className="mt-3 grid gap-2">
                      {activeForwardAddresses.map((address) => (
                        <li
                          key={address}
                          className="rounded-[0.95rem] border border-white/8 bg-[#111820]/80 px-3 py-2 text-sm text-slate-100 break-words"
                        >
                          {address}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-sm text-slate-400">No forward targets returned.</p>
                  )}
                </div>
                <label className="grid gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Fallback forward-to addresses</span>
                  <textarea
                    className={`${fieldClassName()} min-h-52 resize-y`}
                    value={settingsForm.forwardAddressesText}
                    onChange={(e) => onForwardTextChange(e.target.value)}
                    placeholder={"me@example.com\nwork@example.com"}
                  />
                </label>
                <p className="text-sm leading-6 text-slate-400">
                  One email per line. BurnAlias only uses this list when the active provider cannot supply verified forward targets itself.
                </p>
              </div>
            </section>

            <section className={panelClassName("p-5")}>
              <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Active provider</span>
              <p className="mt-2 text-lg text-white">{activeProviderName}</p>
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
            </section>
          </section>
        </div>

        {settingsError ? (
          <div className="rounded-[1.1rem] border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {settingsError}
          </div>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm leading-6 text-slate-400">
            Saving settings updates the active provider and alias composer immediately.
          </p>
          <button
            className="rounded-[1.1rem] bg-linear-to-r from-[#c7924a] to-[#e0b777] px-5 py-3 font-semibold text-[#11161d] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            type="submit"
            disabled={settingsSubmitting}
          >
            {settingsSubmitting ? "Saving..." : "Save settings"}
          </button>
        </div>
      </form>
    </section>
  );
}
