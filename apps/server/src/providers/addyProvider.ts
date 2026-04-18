import { ProviderAlias } from "../domain/alias";
import { logger } from "../lib/logger";
import { extractLabelFromProviderNote } from "../lib/providerNotes";
import {
  AliasPreviewResult,
  AliasProvider,
  ConnectionTestResult,
  CreateProviderAliasInput,
  ForwardTarget,
  UpdateProviderAliasMetadataInput
} from "./provider";

const BASE_URL = "https://app.addy.io";

const log = logger.child({ module: "addyProvider" });

interface AddyEnvelope<T> {
  data: T;
  meta?: {
    current_page?: number;
    last_page?: number;
  };
}

interface AddyTokenDetails {
  username: string;
  from_name: string | null;
  default_alias_domain: string;
}

interface AddyRecipient {
  id: string;
  email: string;
  aliases_count?: number;
  email_verified_at?: string | null;
}

interface AddyAlias {
  id: string;
  email: string;
  active: boolean;
  description: string | null;
  recipients?: AddyRecipient[];
}

export class AddyProvider implements AliasProvider {
  readonly name = "addy";

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
      const response = await this.addyFetch<AddyEnvelope<AddyTokenDetails>>("/api/v1/api-token-details");
      return {
        success: true,
        message: `Connected to Addy.io (${response.data.default_alias_domain})`
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Connection failed."
      };
    }
  }

  async listForwardTargets(): Promise<ForwardTarget[]> {
    const recipients = await this.listRecipients();
    return recipients.map((recipient, index) => ({
      email: recipient.email,
      isDefault: index === 0
    }));
  }

  async getAliasPreview(): Promise<AliasPreviewResult | null> {
    const tokenDetails = await this.getTokenDetails();
    return {
      displaySuffix: `@${tokenDetails.default_alias_domain}`,
      providerHint: tokenDetails.default_alias_domain
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

    const tokenDetails = await this.getTokenDetails();
    const response = await this.addyFetch<AddyEnvelope<AddyAlias>>("/api/v1/aliases", {
      method: "POST",
      body: JSON.stringify({
        domain: tokenDetails.default_alias_domain,
        local_part: input.localPart,
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
          label: extractLabelFromProviderNote(alias.description ?? null)
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
    const response = await this.addyFetch<AddyEnvelope<AddyTokenDetails>>("/api/v1/api-token-details");
    return response.data;
  }

  private async listRecipients(): Promise<AddyRecipient[]> {
    const response = await this.addyFetch<AddyEnvelope<AddyRecipient[]>>(
      "/api/v1/recipients?filter[verified]=true&page[number]=1&page[size]=100"
    );
    return (response.data ?? []).filter((recipient) => Boolean(recipient.email_verified_at));
  }
}
