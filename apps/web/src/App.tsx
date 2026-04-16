import { FormEvent, useEffect, useState } from "react";
import {
  Alias,
  AppSettings,
  ConfiguredProvider,
  ProviderType,
  SchedulerJob,
  SessionState,
  SupportedProviderDefinition,
  ActiveProviderPreview,
  createAlias,
  deleteAlias,
  updateAliasExpiration,
  fetchJobs,
  fetchActiveProviderPreview,
  fetchAliases,
  fetchForwardAddresses,
  fetchSession,
  fetchSettings,
  ForwardAddressState,
  login,
  logout,
  runJob,
  setAliasEnabled,
  syncAliases,
  updateSettings
} from "./api";
import { AppHeader } from "./components/AppHeader";
import { AliasFormState, DashboardView, Filter } from "./components/DashboardView";
import { JobsView } from "./components/JobsView";
import { LoginPage } from "./components/LoginPage";
import { SettingsFormState, SettingsView } from "./components/SettingsView";
import { buildProviderDraft, panelClassName, randomAliasName } from "./lib/utils";

type ViewMode = "dashboard" | "settings" | "jobs";
type ToastTone = "success" | "error" | "info";

type ToastState = {
  message: string;
  tone: ToastTone;
} | null;

const emptyForm: AliasFormState = {
  localPart: "",
  destinationEmail: "",
  expiresAmount: "30",
  expiresUnit: "d",
  label: ""
};

export default function App() {
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [settingsForm, setSettingsForm] = useState<SettingsFormState>({
    providers: [],
    activeProviderId: null,
    forwardAddressesText: "",
    historyRetentionDays: "60"
  });
  const [session, setSession] = useState<SessionState | null>(null);
  const [jobs, setJobs] = useState<SchedulerJob[]>([]);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [activeView, setActiveView] = useState<ViewMode>("dashboard");
  const [authChecking, setAuthChecking] = useState(true);
  const [filter, setFilter] = useState<Filter>("active");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [syncSubmitting, setSyncSubmitting] = useState(false);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [runningJobId, setRunningJobId] = useState<SchedulerJob["id"] | null>(null);
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [settingsSubmitting, setSettingsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [activeProviderPreview, setActiveProviderPreview] = useState<ActiveProviderPreview>({
    suffix: null,
    providerHint: null
  });
  const [forwardAddressState, setForwardAddressState] = useState<ForwardAddressState>({
    forwardAddresses: [],
    source: "none",
    providerName: null
  });
  const [form, setForm] = useState<AliasFormState>({ ...emptyForm, localPart: randomAliasName() });

  // Derived state
  const supportedProviders: SupportedProviderDefinition[] = settings?.providerSettings.supportedProviders ?? [];
  const configuredProviders: ConfiguredProvider[] = settings?.providerSettings.providers ?? [];
  const forwardAddresses: string[] = forwardAddressState.forwardAddresses;
  const activeProvider =
    configuredProviders.find((p) => p.id === settings?.providerSettings.activeProviderId) ?? null;
  const activeProviderMeta = supportedProviders.find((p) => p.type === activeProvider?.type) ?? null;
  const providerSyncJob = jobs.find((job) => job.id === "provider-sync") ?? null;
  const lastProviderSyncLabel = providerSyncJob?.lastFinishedAt
    ? new Date(providerSyncJob.lastFinishedAt).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      })
    : "Not run yet";
  const aliasPreview = (() => {
    const prefix = form.localPart || "alias";
    if (!activeProvider) return `${prefix}@configured-domain`;
    if (activeProviderPreview.suffix) return `${prefix}${activeProviderPreview.suffix}`;
    const fallbackDomain: Partial<Record<string, string>> = {
      simplelogin: "simplelogin.com",
      addy: "addy.io"
    };
    return `${prefix}@${fallbackDomain[activeProvider.type] ?? "configured-domain"}`;
  })();
  const createDisabledReason =
    !activeProvider
      ? "Select an active provider in settings before creating aliases."
      : !activeProviderMeta?.implemented
        ? `${activeProviderMeta?.label ?? activeProvider.name} is not implemented yet.`
        : forwardAddresses.length === 0
          ? forwardAddressState.source === "provider"
            ? `No verified forward targets are available from ${forwardAddressState.providerName ?? activeProvider.name}.`
            : "No forward targets are available. Configure them in settings or connect a provider that exposes them."
          : null;

  // --- Helpers ---

  function syncSettings(nextSettings: AppSettings) {
    setSettings(nextSettings);
    setSettingsForm({
      providers: nextSettings.providerSettings.providers,
      activeProviderId: nextSettings.providerSettings.activeProviderId,
      forwardAddressesText: nextSettings.uiSettings.forwardAddresses.join("\n"),
      historyRetentionDays: String(nextSettings.lifecycleSettings.historyRetentionDays)
    });
  }

  async function loadForwardTargets(fallbackSettings?: AppSettings | null, fallbackProviderName?: string | null) {
    try {
      setForwardAddressState(await fetchForwardAddresses());
    } catch {
      const nextSettings = fallbackSettings ?? settings;
      const nextProviderName = fallbackProviderName ?? activeProvider?.name ?? null;
      setForwardAddressState({
        forwardAddresses: nextSettings?.uiSettings.forwardAddresses ?? [],
        source: (nextSettings?.uiSettings.forwardAddresses?.length ?? 0) > 0 ? "settings" : "none",
        providerName: nextProviderName
      });
    }
  }

  async function loadAliases(selectedFilter: Filter) {
    setLoading(true);
    setError(null);
    try {
      setAliases(await fetchAliases(selectedFilter));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load aliases.");
    } finally {
      setLoading(false);
    }
  }

  async function loadJobs() {
    setJobsLoading(true);
    setJobsError(null);
    try {
      setJobs(await fetchJobs());
    } catch (err) {
      setJobsError(err instanceof Error ? err.message : "Failed to load jobs.");
    } finally {
      setJobsLoading(false);
    }
  }

  function showToast(message: string, tone: ToastTone = "success") {
    setToast({ message, tone });
  }

  // --- Effects ---

  useEffect(() => {
    void (async () => {
      try {
        const nextSession = await fetchSession();
        setSession(nextSession);
        if (nextSession.authenticated) {
          const nextSettings = await fetchSettings();
          syncSettings(nextSettings);
          await loadForwardTargets(nextSettings);
          setJobs(await fetchJobs());
        }
      } catch (err) {
        setLoginError(err instanceof Error ? err.message : "Failed to initialize auth.");
      } finally {
        setAuthChecking(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (session?.authenticated) {
      void loadAliases(filter);
    }
  }, [filter, session?.authenticated]);

  useEffect(() => {
    if (session?.authenticated && activeView === "jobs") {
      void loadJobs();
    }
  }, [activeView, session?.authenticated]);

  useEffect(() => {
    if (!session?.authenticated || !activeProvider) {
      setActiveProviderPreview({ suffix: null, providerHint: null });
      return;
    }
    void fetchActiveProviderPreview()
      .then(setActiveProviderPreview)
      .catch(() => setActiveProviderPreview({ suffix: null, providerHint: null }));
  }, [activeProvider?.id, session?.authenticated]);

  useEffect(() => {
    if (!session?.authenticated) {
      setForwardAddressState({ forwardAddresses: [], source: "none", providerName: null });
      return;
    }

    void loadForwardTargets();
  }, [activeProvider?.id, session?.authenticated]);

  useEffect(() => {
    setForm((cur) => ({
      ...cur,
      destinationEmail: forwardAddresses.includes(cur.destinationEmail)
        ? cur.destinationEmail
        : forwardAddresses[0] ?? ""
    }));
  }, [forwardAddresses]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  // --- Handlers ---

  async function handleLogin(username: string, password: string) {
    setLoginSubmitting(true);
    setLoginError(null);
    try {
      const nextSession = await login(username, password);
      setSession(nextSession);
      const nextSettings = await fetchSettings();
      syncSettings(nextSettings);
      await loadForwardTargets(nextSettings);
      await loadAliases(filter);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setLoginSubmitting(false);
    }
  }

  async function handleLogout() {
    await logout();
    setSession({ authenticated: false });
    setSettings(null);
    setAliases([]);
    setJobs([]);
    setForwardAddressState({ forwardAddresses: [], source: "none", providerName: null });
    setActiveProviderPreview({ suffix: null, providerHint: null });
    setError(null);
    setSettingsError(null);
    setJobsError(null);
    setAccountMenuOpen(false);
    setActiveView("dashboard");
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (createDisabledReason) {
      setError(createDisabledReason);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const expiresInHours = form.expiresAmount
        ? form.expiresUnit === "d"
          ? Number(form.expiresAmount) * 24
          : Number(form.expiresAmount)
        : null;
      await createAlias({
        localPart: form.localPart,
        destinationEmail: form.destinationEmail,
        expiresInHours,
        label: form.label || null,
        providerHint: activeProviderPreview.providerHint
      });
      setForm({ ...emptyForm, localPart: randomAliasName(), destinationEmail: forwardAddresses[0] ?? "", expiresUnit: form.expiresUnit });
      try {
        setActiveProviderPreview(await fetchActiveProviderPreview());
      } catch {
        setActiveProviderPreview({ suffix: null, providerHint: null });
      }
      await loadAliases(filter);
      showToast("Alias created.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create alias.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSettingsSubmit(event: FormEvent) {
    event.preventDefault();
    setSettingsSubmitting(true);
    setSettingsError(null);
    try {
      const nextForwardAddresses = settingsForm.forwardAddressesText
        .split(/\r?\n|,/)
        .map((v) => v.trim())
        .filter(Boolean);
      const nextSettings = await updateSettings({
        auth: { username: settings?.auth.username ?? null },
        providerSettings: {
          supportedProviders,
          providers: settingsForm.providers,
          activeProviderId: settingsForm.activeProviderId
        },
        uiSettings: { forwardAddresses: nextForwardAddresses },
        lifecycleSettings: {
          historyRetentionDays: Number(settingsForm.historyRetentionDays)
        },
        securitySettings: { sessionTtlMs: settings?.securitySettings.sessionTtlMs ?? 0 }
      });
      syncSettings(nextSettings);
      const nextActiveProviderName =
        nextSettings.providerSettings.providers.find(
          (provider) => provider.id === nextSettings.providerSettings.activeProviderId
        )?.name ?? null;
      await loadForwardTargets(nextSettings, nextActiveProviderName);
      showToast("Settings saved.");
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Failed to save settings.");
    } finally {
      setSettingsSubmitting(false);
    }
  }

  async function handleToggle(alias: Alias) {
    try {
      await setAliasEnabled(alias.id, alias.status !== "active");
      await loadAliases(filter);
      showToast(alias.status === "active" ? "Alias set inactive." : "Alias reactivated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update alias.");
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteAlias(id);
      await loadAliases(filter);
      showToast("Alias deleted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete alias.");
    }
  }

  async function handleUpdateExpiration(id: string, expiresInHours: number | null) {
    try {
      await updateAliasExpiration(id, expiresInHours);
      await loadAliases(filter);
      showToast(expiresInHours != null ? "Expiration updated." : "Expiration cleared.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update expiration.");
    }
  }

  async function handleSync() {
    setSyncSubmitting(true);
    setError(null);
    try {
      await syncAliases();
      await loadAliases(filter);
      if (activeView === "jobs") {
        await loadJobs();
      }
      showToast("Alias list refreshed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh aliases.");
    } finally {
      setSyncSubmitting(false);
    }
  }

  async function handleRunJob(jobId: SchedulerJob["id"]) {
    setRunningJobId(jobId);
    setJobsError(null);
    try {
      await runJob(jobId);
      await loadJobs();
      if (jobId === "provider-sync") {
        await loadAliases(filter);
      }
      showToast(
        jobId === "provider-sync"
          ? "Provider sync completed."
          : jobId === "terminal-history-purge"
            ? "Terminal history purge completed."
            : "Expiration sweep completed."
      );
    } catch (err) {
      setJobsError(err instanceof Error ? err.message : "Failed to run job.");
    } finally {
      setRunningJobId(null);
    }
  }

  function handleAddProvider(type: ProviderType) {
    const supportedProvider = supportedProviders.find((p) => p.type === type);
    if (!supportedProvider || settingsForm.providers.some((p) => p.type === type)) return;
    const nextProvider = buildProviderDraft(type, supportedProvider);
    setSettingsForm((cur) => ({
      ...cur,
      providers: [...cur.providers, nextProvider]
    }));
  }

  function handleRemoveProvider(providerId: string) {
    setSettingsForm((cur) => {
      const remaining = cur.providers.filter((p) => p.id !== providerId);
      return {
        ...cur,
        providers: remaining,
        activeProviderId:
          cur.activeProviderId === providerId
            ? remaining[0]?.id ?? null
            : cur.activeProviderId
      };
    });
  }

  function updateProvider(providerId: string, updater: (p: ConfiguredProvider) => ConfiguredProvider) {
    setSettingsForm((cur) => ({
      ...cur,
      providers: cur.providers.map((p) => (p.id === providerId ? updater(p) : p))
    }));
  }

  // --- Render ---

  if (authChecking) {
    return (
      <main className="mx-auto box-border flex min-h-screen w-full max-w-6xl items-center px-4 py-8 sm:px-6">
        <section className={panelClassName("w-full p-8")}>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#d7a968]">BurnAlias</p>
          <h1 className="mt-3 font-serif text-4xl text-white">Loading secure workspace...</h1>
        </section>
      </main>
    );
  }

  if (!session?.authenticated) {
    return (
      <LoginPage
        loginError={loginError}
        loginSubmitting={loginSubmitting}
        onLogin={handleLogin}
      />
    );
  }

  return (
    <main className="mx-auto box-border w-full max-w-7xl px-4 py-5 sm:px-6 sm:py-6">
      <AppHeader
        session={session}
        accountMenuOpen={accountMenuOpen}
        onMenuToggle={() => setAccountMenuOpen((cur) => !cur)}
        onNavigate={(view) => { setActiveView(view); setAccountMenuOpen(false); }}
        onLogout={() => void handleLogout()}
      />

      {toast ? (
        <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] justify-end sm:right-6 sm:top-6">
          <div
            className={[
              "flex items-start gap-3 rounded-[1.1rem] px-4 py-3 text-sm shadow-[0_12px_30px_rgba(0,0,0,0.28)] backdrop-blur",
              toast.tone === "success"
                ? "border border-emerald-400/20 bg-emerald-500/10 text-emerald-200"
                : toast.tone === "error"
                  ? "border border-red-400/20 bg-red-500/10 text-red-200"
                  : "border border-slate-400/20 bg-slate-500/10 text-slate-200"
            ].join(" ")}
          >
            <span className="mt-0.5 shrink-0" aria-hidden="true">
              {toast.tone === "success" ? (
                <svg
                  className="h-4 w-4"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              ) : toast.tone === "error" ? (
                <svg
                  className="h-4 w-4"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="m15 9-6 6" />
                  <path d="m9 9 6 6" />
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
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 16v-4" />
                  <path d="M12 8h.01" />
                </svg>
              )}
            </span>
            <span>{toast.message}</span>
          </div>
        </div>
      ) : null}

      {activeView === "dashboard" && <section className="mb-5">
        <div className={panelClassName("p-6 sm:p-8")}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            Control center
          </p>
          <h1 className="mt-3 max-w-3xl font-serif text-4xl leading-none text-white sm:text-5xl lg:text-6xl">
            {activeProvider ? `${activeProvider.name} is active.` : "Provider setup needed."}
          </h1>
          <p className="mt-5 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
            {activeProvider
              ? "Use the dashboard to create new aliases, adjust expirations, and refresh provider state when needed."
              : "Configure and activate a provider in settings before creating aliases."}
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:max-w-3xl">
            <div className="rounded-[1.1rem] border border-white/8 bg-[#151c26]/92 px-4 py-4">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Active provider</span>
              <strong className="mt-2 block text-xl text-white">{activeProvider?.name ?? "None selected"}</strong>
            </div>
            <div className="rounded-[1.1rem] border border-white/8 bg-[#151c26]/92 px-4 py-4">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Last provider sync</span>
              <strong className="mt-2 block text-xl text-white">{lastProviderSyncLabel}</strong>
            </div>
          </div>
        </div>
      </section>}

      {activeView === "settings" ? (
        <SettingsView
          settingsForm={settingsForm}
          aliases={aliases}
          supportedProviders={supportedProviders}
          settingsError={settingsError}
          settingsSubmitting={settingsSubmitting}
          activeForwardAddressSource={forwardAddressState.source}
          activeForwardAddresses={forwardAddresses}
          activeForwardAddressProviderName={forwardAddressState.providerName}
          onSubmit={handleSettingsSubmit}
          onAddProvider={handleAddProvider}
          onRemoveProvider={handleRemoveProvider}
          onSetActive={(id) => setSettingsForm((cur) => ({ ...cur, activeProviderId: id }))}
          onRenameProvider={(id, name) => updateProvider(id, (p) => ({ ...p, name }))}
          onApiKeyChange={(id, apiKey) =>
            updateProvider(id, (p) =>
              p.type === "simplelogin"
                ? {
                    ...p,
                    config: {
                      ...p.config,
                      apiKey,
                      hasStoredSecret: p.config.hasStoredSecret || Boolean(apiKey),
                      clearStoredSecret: false,
                      lastConnectionTestSucceededAt: apiKey.trim()
                        ? null
                        : p.config.lastConnectionTestSucceededAt ?? null,
                      lastConnectionTestVerificationToken: apiKey.trim()
                        ? null
                        : p.config.lastConnectionTestVerificationToken ?? null
                    }
                  }
                : p
            )
          }
          onClearApiKey={(id) =>
            updateProvider(id, (p) =>
              p.type === "simplelogin"
                ? {
                    ...p,
                    config: {
                      ...p.config,
                      apiKey: "",
                      hasStoredSecret: false,
                      clearStoredSecret: true,
                      lastConnectionTestSucceededAt: null,
                      lastConnectionTestVerificationToken: null
                    }
                  }
                : p
            )
          }
          onConnectionTestSuccess={(id, testedAt, verificationToken) =>
            updateProvider(id, (p) =>
              p.type === "simplelogin"
                ? {
                    ...p,
                    config: {
                      ...p.config,
                      clearStoredSecret: false,
                      lastConnectionTestSucceededAt: testedAt,
                      lastConnectionTestVerificationToken: verificationToken
                    }
                  }
                : p
            )
          }
          onForwardTextChange={(value) => setSettingsForm((cur) => ({ ...cur, forwardAddressesText: value }))}
          onHistoryRetentionDaysChange={(value) => setSettingsForm((cur) => ({ ...cur, historyRetentionDays: value }))}
        />
      ) : activeView === "jobs" ? (
        <JobsView
          jobs={jobs}
          loading={jobsLoading}
          error={jobsError}
          runningJobId={runningJobId}
          onRunJob={handleRunJob}
        />
      ) : (
        <DashboardView
          aliases={aliases}
          configuredProviderTypes={configuredProviders.map((provider) => provider.type)}
          filter={filter}
          error={error}
          loading={loading}
          syncSubmitting={syncSubmitting}
          form={form}
          activeProvider={activeProvider}
          activeProviderMeta={activeProviderMeta}
          forwardAddresses={forwardAddresses}
          forwardAddressSource={forwardAddressState.source}
          aliasPreview={aliasPreview}
          createDisabledReason={createDisabledReason}
          submitting={submitting}
          onFormChange={setForm}
          onFilterChange={setFilter}
          onSubmit={handleSubmit}
          onToggle={handleToggle}
          onDelete={handleDelete}
          onUpdateExpiration={handleUpdateExpiration}
          onSync={handleSync}
        />
      )}
    </main>
  );
}
