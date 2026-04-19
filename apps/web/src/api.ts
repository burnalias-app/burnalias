export type AliasStatus = "active" | "inactive" | "expired" | "deleted";

export interface Alias {
  id: string;
  email: string;
  providerName: string;
  providerAliasId: string;
  destinationEmail: string;
  createdAt: string;
  expiresAt: string | null;
  status: AliasStatus;
  label: string | null;
}

export interface CreateAliasPayload {
  localPart: string;
  destinationEmail: string;
  expiresInHours: number | null;
  label: string | null;
  providerHint?: string | null;
  providerType?: ProviderType;
  aliasFormat?: string | null;
  domainName?: string | null;
}

export type ProviderType = "simplelogin" | "addy";

export interface SupportedProviderDefinition {
  type: ProviderType;
  label: string;
  description: string;
  implemented: boolean;
}

export type ConfiguredProvider =
  | {
      id: string;
      type: "simplelogin";
      name: string;
      config: {
        apiKey: string;
        hasStoredSecret?: boolean;
        clearStoredSecret?: boolean;
        lastConnectionTestSucceededAt?: string | null;
        lastConnectionTestVerificationToken?: string | null;
      };
    }
  | {
      id: string;
      type: "addy";
      name: string;
      config: {
        apiKey: string;
        hasStoredSecret?: boolean;
        clearStoredSecret?: boolean;
        lastConnectionTestSucceededAt?: string | null;
        lastConnectionTestVerificationToken?: string | null;
        supportsCustomAliases?: boolean | null;
        defaultAliasDomain?: string | null;
        defaultAliasFormat?: string | null;
        domainOptions?: string[];
        maxRecipientCount?: number | null;
      };
    };

export interface SessionState {
  authenticated: boolean;
  csrfToken?: string;
  user?: {
    username: string | null;
  };
}

export interface AppSettings {
  auth: {
    username: string | null;
  };
  providerSettings: {
    supportedProviders: SupportedProviderDefinition[];
    providers: ConfiguredProvider[];
    activeProviderId: string | null;
    providerAliasCounts: Record<string, number>;
  };
  lifecycleSettings: {
    historyRetentionDays: number;
  };
  securitySettings: {
    sessionTtlMs: number;
  };
}

export type ForwardAddressSource = "provider" | "none";

export interface ForwardAddressState {
  forwardAddresses: string[];
  source: ForwardAddressSource;
  providerName: string | null;
}

export type JobId = "expiration-sweep" | "terminal-history-purge" | "provider-sync";

export interface SchedulerJob {
  id: JobId;
  title: string;
  description: string;
  intervalMs: number;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  nextRunAt: string | null;
  isRunning: boolean;
  lastOutcome: "idle" | "success" | "error";
  lastSummary: string | null;
}

export interface AuditHistoryEntry {
  id: string;
  aliasId: string;
  aliasEmail: string | null;
  eventType: string;
  message: string;
  createdAt: string;
}

let csrfToken: string | null = null;

function setCsrfToken(nextToken: string | null | undefined): void {
  csrfToken = nextToken ?? null;
}

async function request<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const method = init?.method?.toUpperCase() ?? "GET";
  const headers = new Headers(init?.headers ?? { "Content-Type": "application/json" });

  if (!headers.has("Content-Type") && method !== "GET" && method !== "HEAD") {
    headers.set("Content-Type", "application/json");
  }

  if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && csrfToken) {
    headers.set("X-CSRF-Token", csrfToken);
  }

  const response = await fetch(input, {
    credentials: "include",
    ...init,
    headers
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { error?: string } | null;
    const message = typeof errorBody?.error === "string" ? errorBody.error : "Request failed.";
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export async function fetchAliases(status: AliasStatus | "all"): Promise<Alias[]> {
  const query = status === "all" ? "" : `?status=${status}`;
  const data = await request<{ aliases: Alias[] }>(`/api/aliases${query}`);
  return data.aliases;
}

export async function fetchProviders(): Promise<string[]> {
  const data = await request<{ providers: string[] }>("/api/providers");
  return data.providers;
}

export async function fetchForwardAddresses(providerType?: ProviderType): Promise<ForwardAddressState> {
  const query = providerType ? `?providerType=${providerType}` : "";
  return request<ForwardAddressState>(`/api/forward-addresses${query}`);
}

export async function createAlias(payload: CreateAliasPayload): Promise<Alias> {
  const data = await request<{ alias: Alias }>("/api/aliases", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return data.alias;
}

export async function updateAliasExpiration(id: string, expiresInHours: number | null): Promise<Alias> {
  const data = await request<{ alias: Alias }>(`/api/aliases/${id}/expiration`, {
    method: "PATCH",
    body: JSON.stringify({ expiresInHours })
  });
  return data.alias;
}

export async function updateAliasMetadata(
  id: string,
  payload: {
    destinationEmail: string;
    label: string | null;
  }
): Promise<Alias> {
  const data = await request<{ alias: Alias }>(`/api/aliases/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
  return data.alias;
}

export async function setAliasEnabled(id: string, enabled: boolean): Promise<Alias> {
  const endpoint = enabled ? "enable" : "disable";
  const data = await request<{ alias: Alias }>(`/api/aliases/${id}/${endpoint}`, {
    method: "POST"
  });
  return data.alias;
}

export async function deleteAlias(id: string): Promise<void> {
  await request<void>(`/api/aliases/${id}`, {
    method: "DELETE"
  });
}

export async function syncAliases(): Promise<void> {
  await request<void>("/api/aliases/sync", {
    method: "POST"
  });
}

export async function fetchJobs(): Promise<SchedulerJob[]> {
  const data = await request<{ jobs: SchedulerJob[] }>("/api/jobs");
  return data.jobs;
}

export async function fetchHistory(): Promise<AuditHistoryEntry[]> {
  const data = await request<{ history: AuditHistoryEntry[] }>("/api/history");
  return data.history;
}

export async function runJob(jobId: JobId): Promise<void> {
  await request<void>(`/api/jobs/${jobId}/run`, {
    method: "POST"
  });
}

export async function fetchSession(): Promise<SessionState> {
  const session = await request<SessionState>("/api/auth/session");
  setCsrfToken(session.authenticated ? session.csrfToken : null);
  return session;
}

export async function login(username: string, password: string): Promise<SessionState> {
  const session = await request<SessionState>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
  setCsrfToken(session.authenticated ? session.csrfToken : null);
  return session;
}

export async function logout(): Promise<void> {
  await request<void>("/api/auth/logout", {
    method: "POST"
  });
  setCsrfToken(null);
}

export async function fetchSettings(): Promise<AppSettings> {
  return request<AppSettings>("/api/settings");
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  testedAt?: string;
  verificationToken?: string | null;
  capabilities?: {
    supportsCustomAliases?: boolean;
    defaultAliasDomain?: string | null;
    defaultAliasFormat?: string | null;
    domainOptions?: string[];
    maxRecipientCount?: number | null;
  };
}

export async function testProviderConnection(
  type: ProviderType,
  config: Record<string, string>
): Promise<ConnectionTestResult> {
  return request<ConnectionTestResult>("/api/providers/test", {
    method: "POST",
    body: JSON.stringify({ type, config })
  });
}

export async function fetchActiveProviderSuffix(): Promise<string | null> {
  const data = await request<{ suffix: string | null; providerHint: string | null }>(
    "/api/providers/active/suffix"
  );
  return data.suffix;
}

export interface ActiveProviderPreview {
  suffix: string | null;
  providerHint: string | null;
  usesTypedLocalPart?: boolean;
  generatedLocalPartLabel?: string | null;
  aliasFormatOptions?: Array<{ value: string; label: string }>;
  selectedAliasFormat?: string | null;
  domainOptions?: Array<{ value: string; label: string }>;
  selectedDomain?: string | null;
  maxRecipientCount?: number | null;
}

export async function fetchActiveProviderPreview(
  providerType?: ProviderType,
  options?: {
    aliasFormat?: string | null;
    domainName?: string | null;
  }
): Promise<ActiveProviderPreview> {
  const params = new URLSearchParams();
  if (providerType) params.set("providerType", providerType);
  if (options?.aliasFormat) params.set("aliasFormat", options.aliasFormat);
  if (options?.domainName) params.set("domainName", options.domainName);
  const query = params.toString() ? `?${params.toString()}` : "";
  return request<ActiveProviderPreview>(`/api/providers/active/suffix${query}`);
}

export async function updateSettings(settings: AppSettings): Promise<AppSettings> {
  return request<AppSettings>("/api/settings", {
    method: "PUT",
    body: JSON.stringify({
      providerSettings: {
        providers: settings.providerSettings.providers,
        activeProviderId: settings.providerSettings.activeProviderId
      },
      lifecycleSettings: {
        historyRetentionDays: settings.lifecycleSettings.historyRetentionDays
      }
    })
  });
}
