import { FormEvent } from "react";
import { ConfiguredProvider, ProviderType, SupportedProviderDefinition } from "../api";
import { fieldClassName, panelClassName } from "../lib/utils";
import { ProviderCard } from "./ProviderCard";

export type SettingsFormState = {
  providers: ConfiguredProvider[];
  activeProviderId: string | null;
  forwardAddressesText: string;
};

type SettingsViewProps = {
  settingsForm: SettingsFormState;
  supportedProviders: SupportedProviderDefinition[];
  settingsError: string | null;
  settingsSubmitting: boolean;
  onSubmit: (event: FormEvent) => Promise<void>;
  onAddProvider: (type: ProviderType) => void;
  onRemoveProvider: (providerId: string) => void;
  onSetActive: (providerId: string) => void;
  onToggleEnabled: (providerId: string, enabled: boolean) => void;
  onRenameProvider: (providerId: string, name: string) => void;
  onMockDomainChange: (providerId: string, aliasDomain: string) => void;
  onApiKeyChange: (providerId: string, apiKey: string) => void;
  onForwardTextChange: (value: string) => void;
};

export function SettingsView({
  settingsForm,
  supportedProviders,
  settingsError,
  settingsSubmitting,
  onSubmit,
  onAddProvider,
  onRemoveProvider,
  onSetActive,
  onToggleEnabled,
  onRenameProvider,
  onMockDomainChange,
  onApiKeyChange,
  onForwardTextChange
}: SettingsViewProps) {
  const activeProviderName =
    settingsForm.providers.find((p) => p.id === settingsForm.activeProviderId)?.name ?? "None selected";

  const activeProviderDomain = (() => {
    const selected = settingsForm.providers.find((p) => p.id === settingsForm.activeProviderId);
    return selected?.type === "mock" ? selected.config.aliasDomain : "Defined by the provider integration";
  })();

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
                  <ProviderCard
                    key={provider.id}
                    provider={provider}
                    isActive={settingsForm.activeProviderId === provider.id}
                    meta={supportedProviders.find((item) => item.type === provider.type)}
                    supportedProviders={supportedProviders}
                    onSetActive={onSetActive}
                    onRemove={onRemoveProvider}
                    onRename={onRenameProvider}
                    onToggleEnabled={onToggleEnabled}
                    onMockDomainChange={onMockDomainChange}
                    onApiKeyChange={onApiKeyChange}
                  />
                ))
              )}
            </div>
          </section>

          {/* Right column */}
          <section className="grid gap-5">
            <section className={panelClassName("p-5")}>
              <h3 className="font-serif text-xl text-white">Forward targets</h3>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                These addresses appear in the alias composer when you choose where an alias should forward mail.
              </p>
              <div className="mt-5 grid gap-4">
                <label className="grid gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Forward-to addresses</span>
                  <textarea
                    className={`${fieldClassName()} min-h-52 resize-y`}
                    value={settingsForm.forwardAddressesText}
                    onChange={(e) => onForwardTextChange(e.target.value)}
                    placeholder={"me@example.com\nwork@example.com"}
                    required
                  />
                </label>
                <p className="text-sm leading-6 text-slate-400">
                  One email per line. These become the dropdown choices in the alias composer.
                </p>
              </div>
            </section>

            <section className={panelClassName("p-5")}>
              <h3 className="font-serif text-xl text-white">Current selection</h3>
              <dl className="mt-4 grid gap-4">
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Active provider</dt>
                  <dd className="mt-1 text-sm text-slate-200">{activeProviderName}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Provider domain</dt>
                  <dd className="mt-1 wrap-break-word text-sm text-slate-200">{activeProviderDomain}</dd>
                </div>
              </dl>
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
