import { useState } from "react";
import { ConfiguredProvider, ConnectionTestResult, SupportedProviderDefinition, testProviderConnection } from "../api";
import { configuredProviderLabel, fieldClassName, formatDate } from "../lib/utils";

type TestStatus = "idle" | "testing" | "success" | "error";

type ProviderCardProps = {
  provider: ConfiguredProvider;
  isActive: boolean;
  meta: SupportedProviderDefinition | undefined;
  supportedProviders: SupportedProviderDefinition[];
  canSetActive: boolean;
  canRemove: boolean;
  removeDisabledReason?: string | null;
  onSetActive: (providerId: string) => void;
  onRemove: (providerId: string) => void;
  onRename: (providerId: string, name: string) => void;
  onApiKeyChange: (providerId: string, apiKey: string) => void;
  onClearApiKey: (providerId: string) => void;
  onConnectionTestSuccess: (providerId: string, testedAt: string, verificationToken: string) => void;
};

export function ProviderCard({
  provider,
  isActive,
  meta,
  supportedProviders,
  canSetActive,
  canRemove,
  removeDisabledReason,
  onSetActive,
  onRemove,
  onRename,
  onApiKeyChange,
  onClearApiKey,
  onConnectionTestSuccess
}: ProviderCardProps) {
  const implemented = meta?.implemented ?? false;
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [showTypedApiKey, setShowTypedApiKey] = useState(false);

  async function handleTest() {
    setTestStatus("testing");
    setTestResult(null);
    try {
      const config = provider.type === "simplelogin" ? { apiKey: provider.config.apiKey } : {};
      const result = await testProviderConnection(provider.type, config as Record<string, string>);
      setTestResult(result);
      setTestStatus(result.success ? "success" : "error");
      if (result.success && result.testedAt && result.verificationToken) {
        onConnectionTestSuccess(provider.id, result.testedAt, result.verificationToken);
      }
    } catch (err) {
      setTestResult({ success: false, message: err instanceof Error ? err.message : "Test failed." });
      setTestStatus("error");
    }
  }

  return (
    <article className="rounded-[1.2rem] border border-white/10 bg-[#141b24]/85 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-serif text-lg text-white">{configuredProviderLabel(provider, supportedProviders)}</h4>
            {isActive ? (
              <span className="rounded-full bg-[#d7a968]/18 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#edd3a7]">
                Active
              </span>
            ) : null}
            {!implemented ? (
              <span className="rounded-full bg-slate-500/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-200">
                Coming soon
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-300">{meta?.description ?? "Provider integration settings."}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-full border border-white/10 bg-[#10161f] px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-white transition hover:bg-[#1b2430] disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => onSetActive(provider.id)}
            disabled={!canSetActive}
          >
            {isActive ? "Active provider" : "Set active"}
          </button>
          <button
            type="button"
            className="rounded-full border border-red-400/20 bg-red-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-red-200 transition hover:bg-red-500/15"
            onClick={() => onRemove(provider.id)}
            disabled={!canRemove}
            title={removeDisabledReason ?? undefined}
          >
            Remove
          </button>
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

      {!canRemove && removeDisabledReason ? (
        <p className="mt-3 text-sm leading-6 text-slate-400">{removeDisabledReason}</p>
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
                onChange={(e) => onApiKeyChange(provider.id, e.target.value)}
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
              disabled={testStatus === "testing" || !provider.config.apiKey}
            >
              {testStatus === "testing" ? "Testing..." : "Test connection"}
            </button>
            <button
              type="button"
              className="rounded-[1.1rem] border border-white/10 bg-[#141b24]/88 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-[#1b2430] disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => onClearApiKey(provider.id)}
              disabled={!provider.config.hasStoredSecret && !provider.config.apiKey}
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
        <div className="mt-4 rounded-[1.1rem] border border-white/10 bg-[#10161f] px-4 py-4 text-sm leading-6 text-slate-300">
          Credential fields for {meta?.label ?? provider.type} will be added when that integration is built.
        </div>
      )}
    </article>
  );
}
