import { useState } from "react";
import { ConfiguredProvider, ConnectionTestResult, SupportedProviderDefinition, testProviderConnection } from "../api";
import { configuredProviderLabel, fieldClassName, formatDate } from "../lib/utils";

type TestStatus = "idle" | "testing" | "success" | "error";

type ProviderCardProps = {
  provider: ConfiguredProvider;
  isActive: boolean;
  aliasCount: number;
  meta: SupportedProviderDefinition | undefined;
  supportedProviders: SupportedProviderDefinition[];
  canSetActive: boolean;
  setActiveDisabledReason?: string | null;
  saving: boolean;
  onSetActive: (providerId: string) => void;
  onSetActiveBlocked: (message: string) => void;
  onRename: (providerId: string, name: string) => void;
  onSecretChange: (providerId: string, secret: string) => void;
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
  onSave: (providerId: string) => Promise<void>;
};

export function ProviderCard({
  provider,
  isActive,
  aliasCount,
  meta,
  supportedProviders,
  canSetActive,
  setActiveDisabledReason,
  saving,
  onSetActive,
  onSetActiveBlocked,
  onRename,
  onSecretChange,
  onClearSecret,
  onConnectionTestSuccess,
  onSave
}: ProviderCardProps) {
  const implemented = meta?.implemented ?? false;
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [showTypedApiKey, setShowTypedApiKey] = useState(false);

  async function handleTest() {
    setTestStatus("testing");
    setTestResult(null);
    try {
      const config: Record<string, string> = { apiKey: provider.config.apiKey };
      const result = await testProviderConnection(provider.type, config);
      setTestResult(result);
      setTestStatus(result.success ? "success" : "error");
      if (result.success && result.testedAt && result.verificationToken) {
        onConnectionTestSuccess(provider.id, result.testedAt, result.verificationToken, result.capabilities);
      }
    } catch (err) {
      setTestResult({ success: false, message: err instanceof Error ? err.message : "Test failed." });
      setTestStatus("error");
    }
  }

  function handleSetActiveToggle(nextChecked: boolean) {
    if (saving) {
      onSetActiveBlocked("Settings are already being saved.");
      return;
    }

    if (!nextChecked && isActive) {
      onSetActiveBlocked("Select another ready provider before clearing the current default provider.");
      return;
    }

    if (!canSetActive) {
      onSetActiveBlocked(setActiveDisabledReason ?? "This provider is not ready to be set as the default yet.");
      return;
    }

    if (nextChecked) {
      onSetActive(provider.id);
    }
  }

  return (
    <article className="rounded-[1.2rem] border border-white/10 bg-[#141b24]/85 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-serif text-lg text-white">{configuredProviderLabel(provider, supportedProviders)}</h4>
            <span className="text-sm text-slate-400">{aliasCount} live aliases</span>
            {!implemented ? (
              <span className="rounded-full bg-slate-500/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-200">
                Coming soon
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-300">{meta?.description ?? "Provider integration settings."}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <div
            className={[
              "flex items-center gap-3 rounded-[1.1rem] border border-white/10 bg-[#10161f] px-4 py-2.5 text-white",
              !canSetActive || saving ? "opacity-60" : ""
            ].join(" ")}
            title={setActiveDisabledReason ?? undefined}
          >
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-200">Set default</span>
            <button
              type="button"
              role="switch"
              aria-checked={isActive}
              onClick={() => handleSetActiveToggle(!isActive)}
              className={[
                "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition",
                isActive ? "bg-emerald-500/80" : "bg-slate-600/80"
              ].join(" ")}
            >
              <span
                className={[
                  "inline-block h-5 w-5 rounded-full bg-white transition",
                  isActive ? "translate-x-6" : "translate-x-1"
                ].join(" ")}
              />
            </button>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4">
        <label className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Display name</span>
          <input
            className={fieldClassName()}
            value={provider.name}
            onChange={(e) => onRename(provider.id, e.target.value)}
            required
          />
        </label>
      </div>

      {!canSetActive && setActiveDisabledReason ? (
        <p className="mt-3 text-sm leading-6 text-slate-400">{setActiveDisabledReason}</p>
      ) : null}

      {provider.type === "simplelogin" ? (
        <div className="mt-4 grid gap-4">
          <label className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">API key</span>
            <div className="flex items-center gap-2">
              <input
                className={fieldClassName()}
                type={showTypedApiKey ? "text" : "password"}
                value={provider.config.apiKey}
                onChange={(e) => onSecretChange(provider.id, e.target.value)}
                placeholder={
                  provider.config.hasStoredSecret
                    ? "Stored securely. Enter a new key to replace it."
                    : "Your SimpleLogin API key"
                }
                autoComplete="off"
              />
              <button
                type="button"
                className="shrink-0 rounded-[1.1rem] border border-white/10 bg-[#141b24]/88 px-4 py-3 text-sm text-slate-200 transition hover:bg-[#1b2430]"
                onClick={() => setShowTypedApiKey((value) => !value)}
                aria-label={showTypedApiKey ? "Hide API key" : "Show API key"}
                title={showTypedApiKey ? "Hide typed API key" : "Show typed API key"}
              >
                {showTypedApiKey ? "Hide" : "Show"}
              </button>
            </div>
          </label>

          {provider.config.hasStoredSecret ? (
            <div className="rounded-[1.1rem] border border-white/10 bg-[#10161f] px-4 py-3 text-sm leading-6 text-slate-300">
              <p>A SimpleLogin API key is stored securely for this provider.</p>
              <p className="mt-1 text-slate-400">
                {provider.config.lastConnectionTestSucceededAt
                  ? `Last successful connection test: ${formatDate(provider.config.lastConnectionTestSucceededAt)}`
                  : "The stored key exists, but BurnAlias does not have a successful connection test recorded for it yet."}
              </p>
              {!provider.config.apiKey ? (
                <p className="mt-1 text-slate-400">
                  Leave the field blank to keep the current key, or enter a new key to replace it.
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="rounded-[1.1rem] border border-white/10 bg-[#141b24]/88 px-4 py-2 text-sm font-medium text-white transition hover:bg-[#1b2430] disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => void handleTest()}
              disabled={testStatus === "testing" || !provider.config.apiKey || saving}
            >
              {testStatus === "testing" ? "Testing..." : "Test connection"}
            </button>
            <button
              type="button"
              className="rounded-[1.1rem] border border-white/10 bg-[#141b24]/88 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-[#1b2430] disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => onClearSecret(provider.id)}
              disabled={!provider.config.hasStoredSecret && !provider.config.apiKey || saving}
            >
              Clear key
            </button>

            {testResult ? (
              <span
                className={[
                  "text-sm",
                  testStatus === "success" ? "text-emerald-300" : "text-red-300"
                ].join(" ")}
              >
                {testStatus === "success" ? "Success:" : "Error:"} {testResult.message}
              </span>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="mt-4 grid gap-4">
          <label className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">API key</span>
            <div className="flex items-center gap-2">
              <input
                className={fieldClassName()}
                type={showTypedApiKey ? "text" : "password"}
                value={provider.config.apiKey}
                onChange={(e) => onSecretChange(provider.id, e.target.value)}
                placeholder={
                  provider.config.hasStoredSecret
                    ? "Stored securely. Enter a new key to replace it."
                    : "Your Addy.io API key"
                }
                autoComplete="off"
              />
              <button
                type="button"
                className="shrink-0 rounded-[1.1rem] border border-white/10 bg-[#141b24]/88 px-4 py-3 text-sm text-slate-200 transition hover:bg-[#1b2430]"
                onClick={() => setShowTypedApiKey((value) => !value)}
                aria-label={showTypedApiKey ? "Hide API key" : "Show API key"}
                title={showTypedApiKey ? "Hide typed API key" : "Show typed API key"}
              >
                {showTypedApiKey ? "Hide" : "Show"}
              </button>
            </div>
          </label>

          {provider.config.hasStoredSecret ? (
            <div className="rounded-[1.1rem] border border-white/10 bg-[#10161f] px-4 py-3 text-sm leading-6 text-slate-300">
              <p>An Addy.io API key is stored securely for this provider.</p>
              <p className="mt-1 text-slate-400">
                {provider.config.lastConnectionTestSucceededAt
                  ? `Last successful connection test: ${formatDate(provider.config.lastConnectionTestSucceededAt)}`
                  : "The stored key exists, but BurnAlias does not have a successful connection test recorded for it yet."}
              </p>
              {provider.config.lastConnectionTestSucceededAt ? (
                <p className="mt-1 text-slate-400">
                  {provider.config.supportsCustomAliases
                    ? `Custom alias names are available${provider.config.defaultAliasDomain ? ` on ${provider.config.defaultAliasDomain}` : ""}.`
                    : `This Addy.io account currently creates provider-generated aliases${provider.config.defaultAliasFormat ? ` using ${provider.config.defaultAliasFormat}` : ""}.`}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="rounded-[1.1rem] border border-white/10 bg-[#141b24]/88 px-4 py-2 text-sm font-medium text-white transition hover:bg-[#1b2430] disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => void handleTest()}
              disabled={testStatus === "testing" || !provider.config.apiKey || saving}
            >
              {testStatus === "testing" ? "Testing..." : "Test connection"}
            </button>
            <button
              type="button"
              className="rounded-[1.1rem] border border-white/10 bg-[#141b24]/88 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-[#1b2430] disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => onClearSecret(provider.id)}
              disabled={!provider.config.hasStoredSecret && !provider.config.apiKey || saving}
            >
              Clear key
            </button>

            {testResult ? (
              <span
                className={[
                  "text-sm",
                  testStatus === "success" ? "text-emerald-300" : "text-red-300"
                ].join(" ")}
              >
                {testStatus === "success" ? "Success:" : "Error:"} {testResult.message}
              </span>
            ) : null}
          </div>
        </div>
      )}

      <div className="mt-5 flex justify-end">
        <button
          type="button"
          className="rounded-[1.1rem] bg-linear-to-r from-[#c7924a] to-[#e0b777] px-4 py-2.5 text-sm font-semibold text-[#11161d] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => void onSave(provider.id)}
          disabled={saving}
        >
          {saving ? "Saving..." : "Save provider"}
        </button>
      </div>
    </article>
  );
}
