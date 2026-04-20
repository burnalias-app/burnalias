import { FormEvent, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  Alias,
  AppSettings,
  ConfiguredProvider,
  ProviderType,
  SchedulerJob,
  SessionState,
  SupportedProviderDefinition,
  ActiveProviderPreview,
  AuditHistoryEntry,
  createAlias,
  deleteAlias,
  fetchHistory,
  updateAliasMetadata,
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
  providerType: "",
  aliasFormat: "",
  domainName: "",
  localPart: "",
  destinationEmail: "",
  expiresAmount: "30",
  expiresUnit: "d",
  label: ""
};

function getProviderPreviewCacheKey(
  providerType: ProviderType,
  options?: { aliasFormat?: string | null; domainName?: string | null }
): string {
  return `${providerType}|${options?.aliasFormat ?? ""}|${options?.domainName ?? ""}`;
}

function ensureAllSupportedProviders(
  providers: ConfiguredProvider[],
  supportedProviders: SupportedProviderDefinition[]
): ConfiguredProvider[] {
  return supportedProviders.map((supportedProvider) => {
    return (
      providers.find((provider) => provider.type === supportedProvider.type) ??
      buildProviderDraft(supportedProvider.type, supportedProvider)
    );
  });
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [settingsForm, setSettingsForm] = useState<SettingsFormState>({
    providers: [],
    activeProviderId: null,
    historyRetentionDays: "60"
  });
  const [session, setSession] = useState<SessionState | null>(null);
  const [jobs, setJobs] = useState<SchedulerJob[]>([]);
  const [history, setHistory] = useState<AuditHistoryEntry[]>([]);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [filter, setFilter] = useState<Filter>("active");
  const [aliasSearch, setAliasSearch] = useState("");
  const [aliasSort, setAliasSort] = useState<"created-desc" | "created-asc" | "expires-asc" | "active-first">("active-first");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [syncSubmitting, setSyncSubmitting] = useState(false);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [runningJobId, setRunningJobId] = useState<SchedulerJob["id"] | null>(null);
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [savingSettingsSection, setSavingSettingsSection] = useState<"provider" | "history-retention" | null>(null);
  const [forwardTargetsLoading, setForwardTargetsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [activeProviderPreview, setActiveProviderPreview] = useState<ActiveProviderPreview>({
    suffix: null,
    providerHint: null,
    usesTypedLocalPart: true,
    generatedLocalPartLabel: null
  });
  const [forwardAddressState, setForwardAddressState] = useState<ForwardAddressState>({
    forwardAddresses: [],
    source: "none",
    providerName: null
  });
  const [forwardAddressCache, setForwardAddressCache] = useState<Partial<Record<ProviderType, ForwardAddressState>>>({});
  const [settingsForwardAddressStates, setSettingsForwardAddressStates] = useState<
    Partial<Record<ProviderType, ForwardAddressState>>
  >({});
  const [providerPreviewCache, setProviderPreviewCache] = useState<Record<string, ActiveProviderPreview>>({});
  const [form, setForm] = useState<AliasFormState>({ ...emptyForm, localPart: randomAliasName() });

  // Derived state
  const activeView: ViewMode =
    location.pathname === "/settings"
      ? "settings"
      : location.pathname === "/jobs"
        ? "jobs"
        : "dashboard";
  const supportedProviders: SupportedProviderDefinition[] = settings?.providerSettings.supportedProviders ?? [];
  const configuredProviders: ConfiguredProvider[] = settings?.providerSettings.providers ?? [];
  const providerAliasCounts = settings?.providerSettings.providerAliasCounts ?? {};
  const forwardAddresses: string[] = forwardAddressState.forwardAddresses;
  const defaultProvider =
    configuredProviders.find((p) => p.id === settings?.providerSettings.activeProviderId) ?? null;
  const selectedProvider =
    configuredProviders.find((provider) => provider.type === form.providerType) ?? defaultProvider;
  const selectedProviderMeta = supportedProviders.find((p) => p.type === selectedProvider?.type) ?? null;
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
    if (!selectedProvider) return `${prefix}@configured-domain`;
    if (activeProviderPreview.suffix) {
      const previewPrefix =
        activeProviderPreview.usesTypedLocalPart === false
          ? `<${activeProviderPreview.generatedLocalPartLabel ?? "provider-generated"}>`
          : prefix;
      return `${previewPrefix}${activeProviderPreview.suffix}`;
    }
    const fallbackDomain: Partial<Record<string, string>> = {
      simplelogin: "simplelogin.com",
      addy: "anonaddy.me"
    };
    return `${
      selectedProvider.type === "addy" && activeProviderPreview.usesTypedLocalPart === false
        ? `<${activeProviderPreview.generatedLocalPartLabel ?? "provider-generated"}>`
        : prefix
    }@${fallbackDomain[selectedProvider.type] ?? "configured-domain"}`;
  })();
  const createDisabledReason =
    !defaultProvider
      ? "Set a default provider in settings before creating aliases."
      : !selectedProvider
        ? "Select a provider before creating aliases."
        : !selectedProviderMeta?.implemented
          ? `${selectedProviderMeta?.label ?? selectedProvider.name} is not implemented yet.`
        : forwardAddresses.length === 0
          ? `No verified forward targets are available from ${forwardAddressState.providerName ?? selectedProvider.name}.`
          : null;
  const displayedAliases = (() => {
    const normalizedSearch = aliasSearch.trim().toLowerCase();
    const searched = normalizedSearch
      ? aliases.filter((alias) => {
          return [
            alias.email,
            alias.destinationEmail,
            alias.label ?? "",
            alias.providerName
          ].some((value) => value.toLowerCase().includes(normalizedSearch));
        })
      : aliases;

    const withTime = (value: string | null, fallback: number) => (value ? new Date(value).getTime() : fallback);
    const sorted = [...searched];
    const statusOrder: Record<Alias["status"], number> = {
      active: 0,
      inactive: 1,
      expired: 2,
      deleted: 3
    };

    sorted.sort((left, right) => {
      switch (aliasSort) {
        case "active-first": {
          const statusDifference = statusOrder[left.status] - statusOrder[right.status];
          if (statusDifference !== 0) {
            return statusDifference;
          }

          return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
        }
        case "created-asc":
          return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
        case "expires-asc": {
          const leftIsUpcoming = left.status === "active" || left.status === "inactive";
          const rightIsUpcoming = right.status === "active" || right.status === "inactive";

          if (leftIsUpcoming !== rightIsUpcoming) {
            return leftIsUpcoming ? -1 : 1;
          }

          return withTime(left.expiresAt, Number.MAX_SAFE_INTEGER) - withTime(right.expiresAt, Number.MAX_SAFE_INTEGER);
        }
        case "created-desc":
        default:
          return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
      }
    });

    return sorted;
  })();

  // --- Helpers ---

  function syncSettings(nextSettings: AppSettings) {
    const normalizedProviders = ensureAllSupportedProviders(
      nextSettings.providerSettings.providers,
      nextSettings.providerSettings.supportedProviders
    );
    const defaultProviderType =
      normalizedProviders.find((provider) => provider.id === nextSettings.providerSettings.activeProviderId)?.type ?? "";
    setSettings(nextSettings);
    setSettingsForm({
      providers: normalizedProviders,
      activeProviderId: nextSettings.providerSettings.activeProviderId,
      historyRetentionDays: String(nextSettings.lifecycleSettings.historyRetentionDays)
    });
    setForm((cur) => ({
      ...cur,
      providerType:
        normalizedProviders.some((provider) => provider.type === cur.providerType)
          ? cur.providerType
          : defaultProviderType
    }));
  }

  async function loadForwardTargets(providerType?: ProviderType) {
    if (!providerType) {
      setForwardAddressState({ forwardAddresses: [], source: "none", providerName: null });
      return;
    }

    const cachedState = forwardAddressCache[providerType];
    if (cachedState) {
      setForwardAddressState(cachedState);
    }

    setForwardTargetsLoading(true);
    try {
      const nextState = await fetchForwardAddresses(providerType);
      setForwardAddressCache((cur) => ({ ...cur, [providerType]: nextState }));
      setForwardAddressState(nextState);
    } catch {
      if (!cachedState && !forwardAddressState.forwardAddresses.length) {
        setForwardAddressState({
          forwardAddresses: [],
          source: "none",
          providerName:
            configuredProviders.find((provider) => provider.type === providerType)?.name ??
            defaultProvider?.name ??
            null
        });
      }
    } finally {
      setForwardTargetsLoading(false);
    }
  }

  async function loadProviderPreview(
    providerType: ProviderType,
    options?: {
      aliasFormat?: string | null;
      domainName?: string | null;
    }
  ) {
    const cacheKey = getProviderPreviewCacheKey(providerType, options);
    const cachedPreview = providerPreviewCache[cacheKey];

    if (cachedPreview) {
      setActiveProviderPreview(cachedPreview);
    }

    try {
      const preview = await fetchActiveProviderPreview(providerType, options);
      setProviderPreviewCache((cur) => ({ ...cur, [cacheKey]: preview }));
      setActiveProviderPreview(preview);
    } catch {
      if (!cachedPreview && !activeProviderPreview.suffix && !activeProviderPreview.providerHint) {
        setActiveProviderPreview({
          suffix: null,
          providerHint: null,
          usesTypedLocalPart: true,
          generatedLocalPartLabel: null
        });
      }
    }
  }

  async function loadSettingsForwardTargets(providerTypes: ProviderType[]) {
    setForwardTargetsLoading(true);
    try {
      const entries = await Promise.all(
        providerTypes.map(async (providerType) => {
          try {
            return [providerType, await fetchForwardAddresses(providerType)] as const;
          } catch {
            return [
              providerType,
              {
                forwardAddresses: [],
                source: "none" as const,
                providerName:
                  configuredProviders.find((provider) => provider.type === providerType)?.name ??
                  supportedProviders.find((provider) => provider.type === providerType)?.label ??
                  null
              }
            ] as const;
          }
        })
      );

      const nextStates = Object.fromEntries(entries) as Partial<Record<ProviderType, ForwardAddressState>>;
      setSettingsForwardAddressStates(nextStates);
      setForwardAddressCache((cur) => ({ ...cur, ...nextStates }));
    } finally {
      setForwardTargetsLoading(false);
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
      const [nextJobs, nextHistory] = await Promise.all([fetchJobs(), fetchHistory()]);
      setJobs(nextJobs);
      setHistory(nextHistory);
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
          const defaultProviderType =
            nextSettings.providerSettings.providers.find(
              (provider) => provider.id === nextSettings.providerSettings.activeProviderId
            )?.type;
          await Promise.all([
            loadForwardTargets(defaultProviderType),
            loadSettingsForwardTargets(nextSettings.providerSettings.providers.map((provider) => provider.type))
          ]);
          const [nextJobs, nextHistory] = await Promise.all([fetchJobs(), fetchHistory()]);
          setJobs(nextJobs);
          setHistory(nextHistory);
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
    if (!session?.authenticated || !selectedProvider) {
      setActiveProviderPreview({ suffix: null, providerHint: null, usesTypedLocalPart: true, generatedLocalPartLabel: null });
      return;
    }
    void loadProviderPreview(selectedProvider.type, {
      aliasFormat: form.aliasFormat || null,
      domainName: form.domainName || null
    });
  }, [form.aliasFormat, form.domainName, selectedProvider?.type, session?.authenticated]);

  useEffect(() => {
    if (!session?.authenticated || !selectedProvider) {
      return;
    }

    if (selectedProvider.type !== "addy") {
      setForm((cur) =>
        cur.aliasFormat || cur.domainName
          ? {
              ...cur,
              aliasFormat: "",
              domainName: ""
            }
          : cur
      );
      return;
    }

    setForm((cur) => {
      const nextAliasFormat =
        activeProviderPreview.aliasFormatOptions && activeProviderPreview.aliasFormatOptions.length > 0
          ? activeProviderPreview.aliasFormatOptions.some((option) => option.value === cur.aliasFormat)
            ? cur.aliasFormat
            : activeProviderPreview.selectedAliasFormat ?? activeProviderPreview.aliasFormatOptions[0]?.value ?? ""
          : "";
      const nextDomainName =
        activeProviderPreview.domainOptions && activeProviderPreview.domainOptions.length > 0
          ? activeProviderPreview.domainOptions.some((option) => option.value === cur.domainName)
            ? cur.domainName
            : activeProviderPreview.selectedDomain ?? activeProviderPreview.domainOptions[0]?.value ?? ""
          : "";

      if (nextAliasFormat === cur.aliasFormat && nextDomainName === cur.domainName) {
        return cur;
      }

      return {
        ...cur,
        aliasFormat: nextAliasFormat,
        domainName: nextDomainName
      };
    });
  }, [
    activeProviderPreview.aliasFormatOptions,
    activeProviderPreview.domainOptions,
    activeProviderPreview.selectedAliasFormat,
    activeProviderPreview.selectedDomain,
    selectedProvider?.type,
    session?.authenticated
  ]);

  useEffect(() => {
    if (!session?.authenticated) {
      setForwardAddressState({ forwardAddresses: [], source: "none", providerName: null });
      setSettingsForwardAddressStates({});
      return;
    }

    void loadForwardTargets(selectedProvider?.type);
  }, [selectedProvider?.type, session?.authenticated]);

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
      const defaultProviderType =
        nextSettings.providerSettings.providers.find(
          (provider) => provider.id === nextSettings.providerSettings.activeProviderId
        )?.type;
      await Promise.all([
        loadForwardTargets(defaultProviderType),
        loadSettingsForwardTargets(nextSettings.providerSettings.providers.map((provider) => provider.type))
      ]);
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
    setHistory([]);
    setForwardAddressState({ forwardAddresses: [], source: "none", providerName: null });
    setForwardAddressCache({});
    setSettingsForwardAddressStates({});
    setProviderPreviewCache({});
    setActiveProviderPreview({ suffix: null, providerHint: null, usesTypedLocalPart: true, generatedLocalPartLabel: null });
    setError(null);
    setSettingsError(null);
    setJobsError(null);
    setAccountMenuOpen(false);
    navigate("/dashboard", { replace: true });
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
        providerHint: activeProviderPreview.providerHint,
        providerType: selectedProvider?.type,
        aliasFormat: form.aliasFormat || null,
        domainName: form.domainName || null
      });
      setForm((cur) => ({
        ...emptyForm,
        localPart: randomAliasName(),
        destinationEmail: forwardAddresses[0] ?? "",
        expiresUnit: cur.expiresUnit,
        providerType: cur.providerType,
        aliasFormat: cur.aliasFormat,
        domainName: cur.domainName
      }));
      try {
        if (selectedProvider?.type) {
          await loadProviderPreview(selectedProvider.type, {
            aliasFormat: form.aliasFormat || null,
            domainName: form.domainName || null
          });
        }
      } catch {
        setActiveProviderPreview({ suffix: null, providerHint: null, usesTypedLocalPart: true, generatedLocalPartLabel: null });
      }
      await loadAliases(filter);
      showToast("Alias created.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create alias.");
    } finally {
      setSubmitting(false);
    }
  }

  async function persistSettings(successMessage: string, savingSection: "provider" | "history-retention") {
    setSavingSettingsSection(savingSection);
    setSettingsError(null);
    try {
      const nextSettings = await updateSettings({
        auth: { username: settings?.auth.username ?? null },
        providerSettings: {
          supportedProviders,
          providers: settingsForm.providers,
          activeProviderId: settingsForm.activeProviderId,
          providerAliasCounts
        },
        lifecycleSettings: {
          historyRetentionDays: Number(settingsForm.historyRetentionDays)
        },
        securitySettings: { sessionTtlMs: settings?.securitySettings.sessionTtlMs ?? 0 }
      });
      syncSettings(nextSettings);
      const defaultProviderType =
        nextSettings.providerSettings.providers.find(
          (provider) => provider.id === nextSettings.providerSettings.activeProviderId
        )?.type;
      await Promise.all([
        loadForwardTargets(defaultProviderType),
        loadSettingsForwardTargets(nextSettings.providerSettings.providers.map((provider) => provider.type))
      ]);
      showToast(successMessage);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Failed to save settings.");
    } finally {
      setSavingSettingsSection(null);
    }
  }

  async function handleSaveProvider(_providerId: string) {
    await persistSettings("Provider settings saved.", "provider");
  }

  async function handleSaveHistoryRetention() {
    await persistSettings("History retention saved.", "history-retention");
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

  async function handleUpdateAlias(payload: {
    id: string;
    destinationEmail: string;
    label: string | null;
    enabled: boolean;
    expiresInHours: number | null;
    clearExpiration: boolean;
  }) {
    try {
      const currentAlias = aliases.find((alias) => alias.id === payload.id);
      if (!currentAlias) {
        throw new Error("Alias not found.");
      }

      let changed = false;
      if (
        currentAlias.destinationEmail !== payload.destinationEmail ||
        (currentAlias.label ?? null) !== payload.label
      ) {
        await updateAliasMetadata(payload.id, {
          destinationEmail: payload.destinationEmail,
          label: payload.label
        });
        changed = true;
      }

      if ((currentAlias.status === "active") !== payload.enabled) {
        await setAliasEnabled(payload.id, payload.enabled);
        changed = true;
      }

      if (payload.clearExpiration) {
        if (currentAlias.expiresAt !== null) {
          await updateAliasExpiration(payload.id, null);
          changed = true;
        }
      } else if (payload.expiresInHours != null) {
        await updateAliasExpiration(payload.id, payload.expiresInHours);
        changed = true;
      }

      if (!changed) {
        showToast("No alias changes to save.", "info");
        return;
      }

      await loadAliases(filter);
      showToast("Alias updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update alias.");
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
    <main className="mx-auto box-border w-full max-w-[90rem] px-4 py-5 sm:px-6 sm:py-6">
      {toast ? (
        <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] justify-end sm:right-6 sm:top-6">
          <div
            className={[
              "flex items-start gap-3 rounded-[1.1rem] px-4 py-3 text-sm shadow-[0_12px_30px_rgba(0,0,0,0.28)] backdrop-blur",
              toast.tone === "success"
                ? "border border-emerald-400/20 bg-emerald-500/10 text-emerald-200"
                : toast.tone === "error"
                  ? "border border-red-400/20 bg-red-500/10 text-red-200"
                  : "border border-amber-400/30 bg-amber-500/14 text-amber-100 shadow-[0_12px_30px_rgba(217,119,6,0.18)]"
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

      <AppHeader
        session={session}
        accountMenuOpen={accountMenuOpen}
        onMenuToggle={() => setAccountMenuOpen((cur) => !cur)}
        onMenuClose={() => setAccountMenuOpen(false)}
        activeView={activeView}
        onNavigate={(view) => {
          navigate(`/${view}`);
          setAccountMenuOpen(false);
        }}
        onLogout={() => void handleLogout()}
      />

      {activeView === "dashboard" && <section className="mb-5">
        <div className={panelClassName("p-6 sm:p-8")}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            Control center
          </p>
          <h1 className="mt-3 font-serif text-4xl leading-none text-white sm:text-5xl lg:text-6xl">
            {defaultProvider ? `${defaultProvider.name} is the default provider.` : "Provider setup needed."}
          </h1>
          <p className="mt-5 max-w-3xl text-sm leading-7 text-slate-300 sm:text-base">
            {defaultProvider
              ? "Use the dashboard to create new aliases, adjust expirations, and refresh provider state when needed."
              : "Configure a provider and set a default in settings before creating aliases."}
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <div className="rounded-[1.1rem] border border-white/8 bg-[#151c26]/92 px-4 py-4">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Default provider</span>
              <strong className="mt-2 block text-xl text-white">{defaultProvider?.name ?? "None selected"}</strong>
            </div>
            <div className="rounded-[1.1rem] border border-white/8 bg-[#151c26]/92 px-4 py-4">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Last provider sync</span>
              <strong className="mt-2 block text-xl text-white">{lastProviderSyncLabel}</strong>
            </div>
          </div>
        </div>
      </section>}

      <Routes>
        <Route
          path="/"
          element={<Navigate to="/dashboard" replace />}
        />
        <Route
          path="/dashboard"
          element={
            <DashboardView
              aliases={displayedAliases}
              configuredProviderTypes={configuredProviders.map((provider) => provider.type)}
              filter={filter}
              allTabSearch={aliasSearch}
              allTabSort={aliasSort}
              error={error}
              loading={loading}
              syncSubmitting={syncSubmitting}
              form={form}
              selectedProvider={selectedProvider}
              selectedProviderMeta={selectedProviderMeta}
              providerPreview={activeProviderPreview}
              providerAliasCounts={providerAliasCounts}
              forwardAddresses={forwardAddresses}
              forwardAddressSource={forwardAddressState.source}
              aliasPreview={aliasPreview}
              createDisabledReason={createDisabledReason}
              submitting={submitting}
              onFormChange={setForm}
              onFilterChange={(nextFilter) => {
                setFilter(nextFilter);
                setAliasSearch("");
                setAliasSort(nextFilter === "all" ? "active-first" : "created-desc");
              }}
              onAllTabSearchChange={setAliasSearch}
              onAllTabSortChange={setAliasSort}
              onSubmit={handleSubmit}
              onDelete={handleDelete}
              onUpdateAlias={handleUpdateAlias}
              onSync={handleSync}
            />
          }
        />
        <Route
          path="/settings"
          element={
            <SettingsView
              settingsForm={settingsForm}
              supportedProviders={supportedProviders}
              settingsError={settingsError}
              savingSection={savingSettingsSection}
              forwardTargetsLoading={forwardTargetsLoading}
              providerForwardAddressStates={settingsForwardAddressStates}
              providerAliasCounts={providerAliasCounts}
              onSetActive={(id) => setSettingsForm((cur) => ({ ...cur, activeProviderId: id }))}
              onSetActiveBlocked={(message) => showToast(message, "info")}
              onRenameProvider={(id, name) => updateProvider(id, (p) => ({ ...p, name }))}
              onSecretChange={(id, secret) =>
                updateProvider(id, (p) =>
                  p.type === "simplelogin"
                    ? {
                        ...p,
                        config: {
                          ...p.config,
                          apiKey: secret,
                          hasStoredSecret: p.config.hasStoredSecret || Boolean(secret),
                          clearStoredSecret: false,
                          lastConnectionTestSucceededAt: secret.trim()
                            ? null
                            : p.config.lastConnectionTestSucceededAt ?? null,
                          lastConnectionTestVerificationToken: secret.trim()
                            ? null
                            : p.config.lastConnectionTestVerificationToken ?? null
                        }
                      }
                    : {
                        ...p,
                        config: {
                          ...p.config,
                          apiKey: secret,
                          hasStoredSecret: p.config.hasStoredSecret || Boolean(secret),
                          clearStoredSecret: false,
                          lastConnectionTestSucceededAt: secret.trim()
                            ? null
                            : p.config.lastConnectionTestSucceededAt ?? null,
                          lastConnectionTestVerificationToken: secret.trim()
                            ? null
                            : p.config.lastConnectionTestVerificationToken ?? null,
                          supportsCustomAliases: secret.trim()
                            ? null
                            : p.config.supportsCustomAliases ?? null,
                          defaultAliasDomain: secret.trim()
                            ? null
                            : p.config.defaultAliasDomain ?? null,
                          defaultAliasFormat: secret.trim()
                            ? null
                            : p.config.defaultAliasFormat ?? null,
                          domainOptions: secret.trim()
                            ? []
                            : p.config.domainOptions ?? [],
                          maxRecipientCount: secret.trim()
                            ? null
                            : p.config.maxRecipientCount ?? null
                        }
                      }
                )
              }
              onClearSecret={(id) =>
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
                    : {
                        ...p,
                        config: {
                          ...p.config,
                          apiKey: "",
                          hasStoredSecret: false,
                          clearStoredSecret: true,
                          lastConnectionTestSucceededAt: null,
                          lastConnectionTestVerificationToken: null,
                          supportsCustomAliases: null,
                          defaultAliasDomain: null,
                          defaultAliasFormat: null,
                          domainOptions: [],
                          maxRecipientCount: null
                        }
                      }
                )
              }
              onConnectionTestSuccess={(id, testedAt, verificationToken, capabilities) =>
                updateProvider(id, (p) =>
                  p.type === "addy"
                    ? ({
                        ...p,
                        config: {
                          ...p.config,
                          clearStoredSecret: false,
                          lastConnectionTestSucceededAt: testedAt,
                          lastConnectionTestVerificationToken: verificationToken,
                          supportsCustomAliases: capabilities?.supportsCustomAliases ?? null,
                          defaultAliasDomain: capabilities?.defaultAliasDomain ?? null,
                          defaultAliasFormat: capabilities?.defaultAliasFormat ?? null,
                          domainOptions: capabilities?.domainOptions ?? [],
                          maxRecipientCount: capabilities?.maxRecipientCount ?? null
                        }
                      } as ConfiguredProvider)
                    : ({
                        ...p,
                        config: {
                          ...p.config,
                          clearStoredSecret: false,
                          lastConnectionTestSucceededAt: testedAt,
                          lastConnectionTestVerificationToken: verificationToken
                        }
                      } as ConfiguredProvider)
                )
              }
              onHistoryRetentionDaysChange={(value) => setSettingsForm((cur) => ({ ...cur, historyRetentionDays: value }))}
              onRefreshForwardTargets={async () => {
                await loadSettingsForwardTargets(settingsForm.providers.map((provider) => provider.type));
              }}
              onSaveProvider={handleSaveProvider}
              onSaveHistoryRetention={handleSaveHistoryRetention}
            />
          }
        />
        <Route
          path="/jobs"
      element={
            <JobsView
              jobs={jobs}
              history={history}
              loading={jobsLoading}
              error={jobsError}
              runningJobId={runningJobId}
              onRunJob={handleRunJob}
            />
          }
        />
        <Route
          path="*"
          element={<Navigate to="/dashboard" replace />}
        />
      </Routes>
    </main>
  );
}
