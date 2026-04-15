import { useState } from "react";
import { ConfiguredProvider, ConnectionTestResult, SupportedProviderDefinition, testProviderConnection } from "../api";
import { configuredProviderLabel, fieldClassName } from "../lib/utils";

type TestStatus = "idle" | "testing" | "success" | "error";

type ProviderCardProps = {
  provider: ConfiguredProvider;
  isActive: boolean;
  meta: SupportedProviderDefinition | undefined;
  supportedProviders: SupportedProviderDefinition[];
  onSetActive: (providerId: string) => void;
  onRemove: (providerId: string) => void;
  onRename: (providerId: string, name: string) => void;
  onToggleEnabled: (providerId: string, enabled: boolean) => void;
  onMockDomainChange: (providerId: string, aliasDomain: string) => void;
  onApiKeyChange: (providerId: string, apiKey: string) => void;
};

export function ProviderCard({
  provider,
  isActive,
  meta,
  supportedProviders,
  onSetActive,
  onRemove,
  onRename,
  onToggleEnabled,
  onMockDomainChange,
  onApiKeyChange
}: ProviderCardProps) {
  const implemented = meta?.implemented ?? false;
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);

  async function handleTest() {
    setTestStatus("testing");
    setTestResult(null);
    try {
      const config =
        provider.type === "simplelogin"
          ? { apiKey: provider.config.apiKey }
          : {};
      const result = await testProviderConnection(provider.type, config as Record<string, string>);
      setTestResult(result);
      setTestStatus(result.success ? "success" : "error");
    } catch (err) {
      setTestResult({ success: false, message: err instanceof Error ? err.message : "Test failed." });
      setTestStatus("error");
    }
  }

  return (
    <article className="rounded-[1.2rem] border border-white/10 bg-[#141b24]/85 p-4">
      {/* Header row */}
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
            disabled={!provider.enabled || !implemented}
          >
            {isActive ? "Active provider" : "Set active"}
          </button>
          <button
            type="button"
            className="rounded-full border border-red-400/20 bg-red-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-red-200 transition hover:bg-red-500/15"
            onClick={() => onRemove(provider.id)}
          >
            Remove
          </button>
        </div>
      </div>

      {/* Common fields */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
        <label className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Display name</span>
          <input
            className={fieldClassName()}
            value={provider.name}
            onChange={(e) => onRename(provider.id, e.target.value)}
            required
          />
        </label>
        <label className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Enabled</span>
          <div className="flex h-full items-center rounded-[1.1rem] border border-white/10 bg-[#10161f] px-4 py-3 text-sm text-slate-200">
            <input
              className="mr-3 h-4 w-4 accent-[#d7a968]"
              type="checkbox"
              checked={provider.enabled}
              onChange={(e) => onToggleEnabled(provider.id, e.target.checked)}
            />
            Use this provider in BurnAlias
          </div>
        </label>
      </div>

      {/* Provider-specific config */}
      {provider.type === "mock" ? (
        <div className="mt-4">
          <label className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Alias domain</span>
            <input
              className={fieldClassName()}
              value={provider.config.aliasDomain}
              onChange={(e) => onMockDomainChange(provider.id, e.target.value)}
              placeholder="burnalias.example.com"
              required
            />
          </label>
        </div>
      ) : provider.type === "simplelogin" ? (
        <div className="mt-4 grid gap-4">
          <label className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">API key</span>
            <input
              className={fieldClassName()}
              type="password"
              value={provider.config.apiKey}
              onChange={(e) => onApiKeyChange(provider.id, e.target.value)}
              placeholder="Your SimpleLogin API key"
              autoComplete="off"
            />
          </label>

          {/* Connection test */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="rounded-[1.1rem] border border-white/10 bg-[#141b24]/88 px-4 py-2 text-sm font-medium text-white transition hover:bg-[#1b2430] disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => void handleTest()}
              disabled={testStatus === "testing" || !provider.config.apiKey}
            >
              {testStatus === "testing" ? "Testing..." : "Test connection"}
            </button>

            {testResult ? (
              <span
                className={[
                  "text-sm",
                  testStatus === "success" ? "text-emerald-300" : "text-red-300"
                ].join(" ")}
              >
                {testStatus === "success" ? "✓" : "✗"} {testResult.message}
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
