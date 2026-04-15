import { FormEvent, useEffect, useState } from "react";
import {
  Alias,
  AppSettings,
  ConfiguredProvider,
  ProviderType,
  SessionState,
  SupportedProviderDefinition,
  createAlias,
  deleteAlias,
  fetchActiveProviderSuffix,
  fetchAliases,
  fetchSession,
  fetchSettings,
  login,
  logout,
  setAliasEnabled,
  updateSettings
} from "./api";
import { AppHeader } from "./components/AppHeader";
import { AliasFormState, DashboardView, Filter } from "./components/DashboardView";
import { LoginPage } from "./components/LoginPage";
import { SettingsFormState, SettingsView } from "./components/SettingsView";
import { buildProviderDraft, panelClassName, randomAliasName } from "./lib/utils";

type ViewMode = "dashboard" | "settings";

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
    forwardAddressesText: ""
  });
  const [session, setSession] = useState<SessionState | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [activeView, setActiveView] = useState<ViewMode>("dashboard");
  const [authChecking, setAuthChecking] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [settingsSubmitting, setSettingsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [aliasSuffix, setAliasSuffix] = useState<string | null>(null);
  const [form, setForm] = useState<AliasFormState>({ ...emptyForm, localPart: randomAliasName() });

  // Derived state
  const supportedProviders: SupportedProviderDefinition[] = settings?.providerSettings.supportedProviders ?? [];
  const configuredProviders: ConfiguredProvider[] = settings?.providerSettings.providers ?? [];
  const forwardAddresses: string[] = settings?.uiSettings.forwardAddresses ?? [];
  const activeProvider =
    configuredProviders.find((p) => p.id === settings?.providerSettings.activeProviderId) ?? null;
  const activeProviderMeta = supportedProviders.find((p) => p.type === activeProvider?.type) ?? null;
  const aliasPreview = (() => {
    const prefix = form.localPart || "alias";
    if (!activeProvider) return `${prefix}@configured-domain`;
    if (activeProvider.type === "mock") return `${prefix}@${activeProvider.config.aliasDomain}`;
    if (aliasSuffix) return `${prefix}${aliasSuffix}`;
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
          ? "Add at least one forward-to address in settings."
          : null;

  // --- Helpers ---

  function syncSettings(nextSettings: AppSettings) {
    setSettings(nextSettings);
    setSettingsForm({
      providers: nextSettings.providerSettings.providers,
      activeProviderId: nextSettings.providerSettings.activeProviderId,
      forwardAddressesText: nextSettings.uiSettings.forwardAddresses.join("\n")
    });
    setForm((cur) => ({
      ...cur,
      destinationEmail: nextSettings.uiSettings.forwardAddresses.includes(cur.destinationEmail)
        ? cur.destinationEmail
        : nextSettings.uiSettings.forwardAddresses[0] ?? ""
    }));
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

  // --- Effects ---

  useEffect(() => {
    void (async () => {
      try {
        const nextSession = await fetchSession();
        setSession(nextSession);
        if (nextSession.authenticated) {
          const nextSettings = await fetchSettings();
          syncSettings(nextSettings);
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
    if (!session?.authenticated || !activeProvider || activeProvider.type === "mock") {
      setAliasSuffix(null);
      return;
    }
    void fetchActiveProviderSuffix()
      .then(setAliasSuffix)
      .catch(() => setAliasSuffix(null));
  }, [activeProvider?.id, session?.authenticated]);

  useEffect(() => {
    if (!toastMessage) return;
    const timeout = window.setTimeout(() => setToastMessage(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [toastMessage]);

  // --- Handlers ---

  async function handleLogin(username: string, password: string) {
    setLoginSubmitting(true);
    setLoginError(null);
    try {
      const nextSession = await login(username, password);
      setSession(nextSession);
      const nextSettings = await fetchSettings();
      syncSettings(nextSettings);
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
    setError(null);
    setSettingsError(null);
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
        label: form.label || null
      });
      setForm({ ...emptyForm, localPart: randomAliasName(), destinationEmail: forwardAddresses[0] ?? "", expiresUnit: form.expiresUnit });
      await loadAliases(filter);
      setToastMessage("Alias created.");
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
        securitySettings: { sessionTtlMs: settings?.securitySettings.sessionTtlMs ?? 0 }
      });
      syncSettings(nextSettings);
      setToastMessage("Settings saved.");
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update alias.");
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteAlias(id);
      await loadAliases(filter);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete alias.");
    }
  }

  function handleAddProvider(type: ProviderType) {
    const supportedProvider = supportedProviders.find((p) => p.type === type);
    if (!supportedProvider || settingsForm.providers.some((p) => p.type === type)) return;
    const nextProvider = buildProviderDraft(type, supportedProvider, settingsForm.providers);
    setSettingsForm((cur) => ({
      ...cur,
      providers: [...cur.providers, nextProvider],
      activeProviderId: cur.activeProviderId ?? (supportedProvider.implemented ? nextProvider.id : null)
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
            ? remaining.find((p) => p.enabled)?.id ?? null
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
      <main className="mx-auto flex min-h-screen w-full max-w-6xl items-center px-4 py-8 sm:px-6">
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
    <main className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 sm:py-6">
      <AppHeader
        session={session}
        accountMenuOpen={accountMenuOpen}
        onMenuToggle={() => setAccountMenuOpen((cur) => !cur)}
        onNavigate={(view) => { setActiveView(view); setAccountMenuOpen(false); }}
        onLogout={() => void handleLogout()}
      />

      {toastMessage ? (
        <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] justify-end sm:right-6 sm:top-6">
          <div className="rounded-[1.1rem] border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200 shadow-[0_12px_30px_rgba(0,0,0,0.28)] backdrop-blur">
            {toastMessage}
          </div>
        </div>
      ) : null}

      {activeView === "dashboard" && <section className="mb-5 grid gap-4 lg:grid-cols-[1.35fr_0.95fr]">
        <div className={panelClassName("p-6 sm:p-8")}>
          <h1 className="max-w-3xl font-serif text-4xl leading-none text-white sm:text-5xl lg:text-6xl">
            Disposable aliases with real expiration controls.
          </h1>
          <p className="mt-5 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
            Generate aliases against your active provider, route them to a saved forward target, and let BurnAlias disable them automatically when their lifespan runs out.
          </p>
        </div>
        <div className={panelClassName("grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-1")}>
          <div className="rounded-[1.1rem] border border-white/8 bg-[#151c26]/92 px-4 py-4">
            <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Aliases</span>
            <strong className="mt-2 block text-2xl text-white sm:text-3xl">{aliases.length}</strong>
          </div>
          <div className="rounded-[1.1rem] border border-white/8 bg-[#151c26]/92 px-4 py-4">
            <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Configured Providers</span>
            <strong className="mt-2 block text-2xl text-white sm:text-3xl">{configuredProviders.length}</strong>
          </div>
          <div className="rounded-[1.1rem] border border-white/8 bg-[#151c26]/92 px-4 py-4">
            <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Active Provider</span>
            <strong className="mt-2 block text-2xl text-white sm:text-3xl">{activeProvider?.name ?? "None"}</strong>
          </div>
        </div>
      </section>}

      {activeView === "settings" ? (
        <SettingsView
          settingsForm={settingsForm}
          supportedProviders={supportedProviders}
          settingsError={settingsError}
          settingsSubmitting={settingsSubmitting}
          onSubmit={handleSettingsSubmit}
          onAddProvider={handleAddProvider}
          onRemoveProvider={handleRemoveProvider}
          onSetActive={(id) => setSettingsForm((cur) => ({ ...cur, activeProviderId: id }))}
          onToggleEnabled={(id, enabled) =>
            setSettingsForm((cur) => ({
              ...cur,
              activeProviderId: !enabled && cur.activeProviderId === id ? null : cur.activeProviderId,
              providers: cur.providers.map((p) => (p.id === id ? { ...p, enabled } : p))
            }))
          }
          onRenameProvider={(id, name) => updateProvider(id, (p) => ({ ...p, name }))}
          onMockDomainChange={(id, aliasDomain) =>
            updateProvider(id, (p) => p.type === "mock" ? { ...p, config: { aliasDomain } } : p)
          }
          onApiKeyChange={(id, apiKey) =>
            updateProvider(id, (p) => p.type === "simplelogin" ? { ...p, config: { apiKey } } : p)
          }
          onForwardTextChange={(value) => setSettingsForm((cur) => ({ ...cur, forwardAddressesText: value }))}
        />
      ) : (
        <DashboardView
          aliases={aliases}
          filter={filter}
          error={error}
          loading={loading}
          form={form}
          activeProvider={activeProvider}
          activeProviderMeta={activeProviderMeta}
          forwardAddresses={forwardAddresses}
          aliasPreview={aliasPreview}
          createDisabledReason={createDisabledReason}
          submitting={submitting}
          onFormChange={setForm}
          onFilterChange={setFilter}
          onSubmit={handleSubmit}
          onToggle={handleToggle}
          onDelete={handleDelete}
        />
      )}
    </main>
  );
}
