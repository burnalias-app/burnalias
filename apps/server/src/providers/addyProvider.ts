import { ProviderAlias } from "../domain/alias";
import { logger } from "../lib/logger";
import { extractLabelFromProviderNote } from "../lib/providerNotes";
import {
  AliasPreviewResult,
  AliasProvider,
  ConnectionTestResult,
  CreateProviderAliasInput,
  ForwardTarget,
  ProviderPreviewInput,
  UpdateProviderAliasMetadataInput
} from "./provider";

const BASE_URL = "https://app.addy.io";
const CACHE_TTL_MS = 30_000;

const log = logger.child({ module: "addyProvider" });

interface AddyEnvelope<T> {
  data: T;
  meta?: {
    current_page?: number;
    last_page?: number;
  };
}

interface AddyTokenDetails {
  name?: string | null;
  created_at?: string | null;
  expires_at?: string | null;
}

interface AddyAccountDetails {
  username: string;
  from_name: string | null;
  default_alias_domain: string;
  default_alias_format?: string | null;
  subscription?: string | null;
  recipient_limit?: number | null;
}

interface AddyRecipient {
  id: string;
  email: string;
  aliases_count?: number;
  email_verified_at?: string | null;
}

interface AddyDomainOptionEnvelope {
  data: Array<string | { domain?: string | null }>;
}

interface AddyAlias {
  id: string;
  email: string;
  active: boolean;
  description: string | null;
  created_at?: string | null;
  recipients?: AddyRecipient[];
}

const FREE_ALIAS_FORMATS = ["random_characters", "uuid"] as const;
const PAID_ALIAS_FORMATS = [
  "custom",
  "random_words",
  "random_male_name",
  "random_female_name",
  "random_noun",
  "random_characters",
  "uuid"
] as const;
const FREE_ALIAS_FORMATS_LIST = [...FREE_ALIAS_FORMATS] as string[];
const PAID_ALIAS_FORMATS_LIST = [...PAID_ALIAS_FORMATS] as string[];

function addyAliasFormatOptions(supportsCustomAliases: boolean): Array<{ value: string; label: string }> {
  const formats = supportsCustomAliases ? PAID_ALIAS_FORMATS : FREE_ALIAS_FORMATS;
  return formats.map((format) => ({
    value: format,
    label:
      format === "custom"
        ? "Custom Alias"
        : format === "random_words"
          ? "Random Words"
          : format === "random_male_name"
            ? "Random Male Name"
            : format === "random_female_name"
              ? "Random Female Name"
              : format === "random_noun"
                ? "Random Noun"
                : format === "random_characters"
                  ? "Random characters"
                  : "UUID"
  }));
}

export class AddyProvider implements AliasProvider {
  readonly name = "addy";
  private accountDetailsCache: { value: AddyAccountDetails; expiresAt: number } | null = null;
  private accountDetailsPromise: Promise<AddyAccountDetails> | null = null;
  private recipientsCache: { value: AddyRecipient[]; expiresAt: number } | null = null;
  private recipientsPromise: Promise<AddyRecipient[]> | null = null;
  private domainOptionsCache = new Map<string, { value: string[]; expiresAt: number }>();
  private domainOptionsPromise = new Map<string, Promise<string[]>>();

  constructor(private readonly apiKey: string) {}

  private async addyFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${BASE_URL}${path}`;
    log.trace({ method: init?.method ?? "GET", path }, "Addy API request");

    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        Accept: "application/json",
        ...(init?.headers ?? {})
      }
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
      const message = body.message ?? body.error ?? `Addy API error: ${response.status} ${response.statusText}`;
      log.warn({ path, status: response.status, message }, "Addy API request failed");
      throw new Error(message);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const capabilities = await this.getConfigurationCapabilities();
      const accountDetails = await this.getAccountDetails();
      const supportsCustomAliases = this.supportsCustomAliases(accountDetails);
      return {
        success: true,
        message: supportsCustomAliases
          ? `Connected to Addy.io (${accountDetails.default_alias_domain}, custom aliases available)`
          : `Connected to Addy.io (${accountDetails.default_alias_domain}, provider-generated aliases only)`,
        capabilities
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Connection failed."
      };
    }
  }

  async getConfigurationCapabilities(): Promise<ConnectionTestResult["capabilities"] | undefined> {
    const accountDetails = await this.getAccountDetails();
    const domainOptions = await this.listDomainOptions(accountDetails.default_alias_domain);
    return {
      supportsCustomAliases: this.supportsCustomAliases(accountDetails),
      defaultAliasDomain: accountDetails.default_alias_domain,
      defaultAliasFormat: accountDetails.default_alias_format ?? null,
      domainOptions,
      maxRecipientCount: accountDetails.recipient_limit ?? null
    };
  }

  async listForwardTargets(): Promise<ForwardTarget[]> {
    const recipients = await this.listRecipients();
    return recipients.map((recipient, index) => ({
      email: recipient.email,
      isDefault: index === 0
    }));
  }

  async getAliasPreview(input?: ProviderPreviewInput): Promise<AliasPreviewResult | null> {
    const tokenDetails = await this.getAccountDetails();
    const supportsCustomAliases = this.supportsCustomAliases(tokenDetails);
    const domainOptions = await this.listDomainOptions(tokenDetails.default_alias_domain);
    const selectedDomain =
      input?.domainName && domainOptions.includes(input.domainName)
        ? input.domainName
        : tokenDetails.default_alias_domain;
    const defaultFreePlanFormat =
      tokenDetails.default_alias_format && ["random_characters", "uuid"].includes(tokenDetails.default_alias_format)
        ? tokenDetails.default_alias_format
        : "random_characters";
    const availableFormats = supportsCustomAliases ? PAID_ALIAS_FORMATS_LIST : FREE_ALIAS_FORMATS_LIST;
    const defaultPaidFormat =
      tokenDetails.default_alias_format && availableFormats.includes(tokenDetails.default_alias_format)
        ? tokenDetails.default_alias_format
        : "custom";
    const selectedAliasFormat =
      input?.aliasFormat && availableFormats.includes(input.aliasFormat)
        ? input.aliasFormat
        : supportsCustomAliases
          ? defaultPaidFormat
          : defaultFreePlanFormat;
    return {
      displaySuffix: `@${selectedDomain}`,
      providerHint: selectedDomain,
      usesTypedLocalPart: selectedAliasFormat === "custom",
      generatedLocalPartLabel: selectedAliasFormat === "custom"
        ? null
        : this.describeAliasFormat(selectedAliasFormat),
      aliasFormatOptions: addyAliasFormatOptions(supportsCustomAliases),
      selectedAliasFormat,
      domainOptions: domainOptions.map((domain) => ({ value: domain, label: domain })),
      selectedDomain,
      maxRecipientCount: tokenDetails.recipient_limit ?? null
    };
  }

  async createAlias(input: CreateProviderAliasInput): Promise<ProviderAlias> {
    const recipients = await this.listRecipients();
    const selectedRecipient = input.destinationEmail
      ? recipients.find((recipient) => recipient.email.toLowerCase() === input.destinationEmail?.toLowerCase())
      : recipients[0];

    if (!selectedRecipient) {
      throw new Error("No verified recipients found on your Addy.io account.");
    }

    if (input.destinationEmail && selectedRecipient.email.toLowerCase() !== input.destinationEmail.toLowerCase()) {
      throw new Error(
        `The forward-to address ${input.destinationEmail} is not configured as a verified recipient in Addy.io.`
      );
    }

    const tokenDetails = await this.getAccountDetails();
    const supportsCustomAliases = this.supportsCustomAliases(tokenDetails);
    const defaultFreePlanFormat =
      tokenDetails.default_alias_format && ["random_characters", "uuid"].includes(tokenDetails.default_alias_format)
        ? tokenDetails.default_alias_format
        : "random_characters";
    const availableFormats = supportsCustomAliases ? PAID_ALIAS_FORMATS_LIST : FREE_ALIAS_FORMATS_LIST;
    const defaultPaidFormat =
      tokenDetails.default_alias_format && availableFormats.includes(tokenDetails.default_alias_format)
        ? tokenDetails.default_alias_format
        : "custom";
    const selectedFormat =
      input.aliasFormat && availableFormats.includes(input.aliasFormat)
        ? input.aliasFormat
        : supportsCustomAliases
          ? defaultPaidFormat
          : defaultFreePlanFormat;
    if (selectedFormat === "custom" && !input.localPart.trim()) {
      throw new Error("Custom Alias requires a local part.");
    }
    const domainOptions = await this.listDomainOptions(tokenDetails.default_alias_domain);
    const selectedDomain =
      input.domainName && domainOptions.includes(input.domainName)
        ? input.domainName
        : tokenDetails.default_alias_domain;
    const response = await this.addyFetch<AddyEnvelope<AddyAlias>>("/api/v1/aliases", {
      method: "POST",
      body: JSON.stringify({
        domain: selectedDomain,
        format: selectedFormat,
        ...(selectedFormat === "custom" ? { local_part: input.localPart } : {}),
        description: input.note ?? input.label ?? null,
        recipient_ids: [selectedRecipient.id]
      })
    });

    return {
      id: response.data.id,
      email: response.data.email,
      destinationEmail: selectedRecipient.email,
      enabled: response.data.active,
      label: extractLabelFromProviderNote(response.data.description ?? input.note ?? input.label ?? null)
    };
  }

  async updateAliasMetadata(providerAliasId: string, input: UpdateProviderAliasMetadataInput): Promise<void> {
    if (typeof input.note !== "undefined") {
      await this.addyFetch<AddyEnvelope<AddyAlias>>(`/api/v1/aliases/${providerAliasId}`, {
        method: "PATCH",
        body: JSON.stringify({
          description: input.note ?? ""
        })
      });
    }

    if (input.destinationEmail) {
      const recipients = await this.listRecipients();
      const selectedRecipient = recipients.find(
        (recipient) => recipient.email.toLowerCase() === input.destinationEmail?.toLowerCase()
      );

      if (!selectedRecipient) {
        throw new Error(
          `The forward-to address ${input.destinationEmail} is not configured as a verified recipient in Addy.io.`
        );
      }

      await this.addyFetch<AddyEnvelope<AddyAlias>>("/api/v1/alias-recipients", {
        method: "POST",
        body: JSON.stringify({
          alias_id: providerAliasId,
          recipient_ids: [selectedRecipient.id]
        })
      });
    }
  }

  async disableAlias(providerAliasId: string): Promise<void> {
    await this.addyFetch(`/api/v1/active-aliases/${providerAliasId}`, {
      method: "DELETE"
    });
  }

  async enableAlias(providerAliasId: string): Promise<void> {
    await this.addyFetch("/api/v1/active-aliases", {
      method: "POST",
      body: JSON.stringify({ id: providerAliasId })
    });
  }

  async deleteAlias(providerAliasId: string): Promise<void> {
    await this.addyFetch(`/api/v1/aliases/${providerAliasId}`, {
      method: "DELETE"
    });
  }

  async listAliases(): Promise<ProviderAlias[]> {
    const aliases: ProviderAlias[] = [];
    let page = 1;

    while (true) {
      const response = await this.addyFetch<AddyEnvelope<AddyAlias[]>>(
        `/api/v1/aliases?page[number]=${page}&page[size]=100&with=recipients`
      );
      const pageAliases = response.data ?? [];

      aliases.push(
        ...pageAliases.map((alias) => ({
          id: alias.id,
          email: alias.email,
          destinationEmail: alias.recipients?.[0]?.email ?? "",
          enabled: alias.active,
          label: extractLabelFromProviderNote(alias.description ?? null),
          createdAt: alias.created_at ?? null
        }))
      );

      if (pageAliases.length < 100) {
        break;
      }

      page += 1;
    }

    return aliases;
  }

  private async getTokenDetails(): Promise<AddyTokenDetails> {
    const response = await this.addyFetch<AddyEnvelope<AddyTokenDetails | AddyTokenDetails[]>>(
      "/api/v1/api-token-details"
    );
    const details = Array.isArray(response.data) ? response.data[0] : response.data;
    if (!details) {
      throw new Error("Addy.io did not return API token details.");
    }

    return details;
  }

  private async getAccountDetails(): Promise<AddyAccountDetails> {
    if (this.accountDetailsCache && this.accountDetailsCache.expiresAt > Date.now()) {
      return this.accountDetailsCache.value;
    }

    if (this.accountDetailsPromise) {
      return this.accountDetailsPromise;
    }

    this.accountDetailsPromise = (async () => {
      const response = await this.addyFetch<AddyEnvelope<AddyAccountDetails | AddyAccountDetails[]>>(
        "/api/v1/account-details"
      );
      const details = Array.isArray(response.data) ? response.data[0] : response.data;
      if (!details?.default_alias_domain) {
        throw new Error("Addy.io did not return account details.");
      }

      this.accountDetailsCache = {
        value: details,
        expiresAt: Date.now() + CACHE_TTL_MS
      };
      return details;
    })();

    try {
      return await this.accountDetailsPromise;
    } finally {
      this.accountDetailsPromise = null;
    }
  }

  private async listRecipients(): Promise<AddyRecipient[]> {
    if (this.recipientsCache && this.recipientsCache.expiresAt > Date.now()) {
      return this.recipientsCache.value;
    }

    if (this.recipientsPromise) {
      return this.recipientsPromise;
    }

    this.recipientsPromise = (async () => {
      const response = await this.addyFetch<AddyEnvelope<AddyRecipient[]>>(
        "/api/v1/recipients?filter[verified]=true&page[number]=1&page[size]=100"
      );
      const recipients = (response.data ?? []).filter((recipient) => Boolean(recipient.email_verified_at));
      this.recipientsCache = {
        value: recipients,
        expiresAt: Date.now() + CACHE_TTL_MS
      };
      return recipients;
    })();

    try {
      return await this.recipientsPromise;
    } finally {
      this.recipientsPromise = null;
    }
  }

  private async listDomainOptions(defaultDomain: string): Promise<string[]> {
    const cachedValue = this.domainOptionsCache.get(defaultDomain);
    if (cachedValue && cachedValue.expiresAt > Date.now()) {
      return cachedValue.value;
    }

    const inflightValue = this.domainOptionsPromise.get(defaultDomain);
    if (inflightValue) {
      return inflightValue;
    }

    try {
      const request = (async () => {
        const response = await this.addyFetch<AddyDomainOptionEnvelope>("/api/v1/domain-options");
        const options = (response.data ?? [])
          .map((entry) => (typeof entry === "string" ? entry : entry.domain ?? null))
          .filter((entry): entry is string => Boolean(entry));
        const normalizedOptions = options.length > 0 ? options : [defaultDomain];
        this.domainOptionsCache.set(defaultDomain, {
          value: normalizedOptions,
          expiresAt: Date.now() + CACHE_TTL_MS
        });
        return normalizedOptions;
      })();

      this.domainOptionsPromise.set(defaultDomain, request);
      return await request;
    } catch {
      return [defaultDomain];
    } finally {
      this.domainOptionsPromise.delete(defaultDomain);
    }
  }

  private supportsCustomAliases(details: AddyAccountDetails): boolean {
    return (details.subscription ?? "free").toLowerCase() !== "free";
  }

  private describeAliasFormat(format: string | null | undefined): string {
    switch (format) {
      case "uuid":
        return "uuid";
      case "random_words":
        return "random-words";
      case "random_male_name":
        return "random-male-name";
      case "random_female_name":
        return "random-female-name";
      case "random_noun":
        return "random-noun";
      case "random_characters":
      default:
        return "random-characters";
    }
  }
}
