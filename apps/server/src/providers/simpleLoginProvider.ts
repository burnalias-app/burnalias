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

const BASE_URL = "https://api.simplelogin.io";

const log = logger.child({ module: "simpleLoginProvider" });

interface SlUserInfo {
  email: string;
  name: string;
}

interface SlSuffix {
  suffix: string;
  signed_suffix: string;
}

interface SlAliasOptions {
  suffixes: SlSuffix[];
}

interface SlMailbox {
  id: number;
  email: string;
  default: boolean;
}

interface SlMailboxList {
  mailboxes: SlMailbox[];
}

interface SlAlias {
  id: number;
  email: string;
  note?: string | null;
  enabled: boolean;
  mailboxes?: Array<{
    email: string;
  }>;
}

interface SlAliasDetails extends SlAlias {
  mailbox: {
    email: string;
  } | null;
}

interface SlAliasList {
  aliases: SlAlias[];
}

export class SimpleLoginProvider implements AliasProvider {
  readonly name = "simplelogin";

  constructor(private readonly apiKey: string) {}

  private async slFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${BASE_URL}${path}`;
    log.trace({ method: init?.method ?? "GET", path }, "SimpleLogin API request");

    const response = await fetch(url, {
      ...init,
      headers: {
        Authentication: this.apiKey,
        "Content-Type": "application/json",
        ...(init?.headers ?? {})
      }
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      const message = body.error ?? `SimpleLogin API error: ${response.status} ${response.statusText}`;
      log.warn({ path, status: response.status, message }, "SimpleLogin API request failed");
      throw new Error(message);
    }

    return response.json() as Promise<T>;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const data = await this.slFetch<SlUserInfo>("/api/user_info");
      return { success: true, message: `Connected as ${data.email}` };
    } catch (err) {
      return {
        success: false,
        message: err instanceof Error ? err.message : "Connection failed."
      };
    }
  }

  async listForwardTargets(): Promise<ForwardTarget[]> {
    const { mailboxes } = await this.listMailboxes();
    return mailboxes.map((mailbox) => ({
      email: mailbox.email,
      isDefault: mailbox.default
    }));
  }

  async getFirstSuffix(): Promise<string | null> {
    try {
      const preview = await this.getAliasPreview();
      return preview?.displaySuffix ?? null;
    } catch {
      return null;
    }
  }

  async getAliasPreview(): Promise<AliasPreviewResult | null> {
    const options = await this.slFetch<SlAliasOptions>("/api/v5/alias/options");
    const suffix = options.suffixes[0];
    if (!suffix) {
      return null;
    }

    return {
      displaySuffix: suffix.suffix,
      providerHint: suffix.signed_suffix
    };
  }

  async createAlias(input: CreateProviderAliasInput): Promise<ProviderAlias> {
    const { mailboxes } = await this.listMailboxes();
    const selectedMailbox = input.destinationEmail
      ? mailboxes.find((mailbox) => mailbox.email.toLowerCase() === input.destinationEmail?.toLowerCase())
      : mailboxes.find((mailbox) => mailbox.default) ?? mailboxes[0];

    if (!selectedMailbox) {
      throw new Error("No mailboxes found on your SimpleLogin account.");
    }

    if (input.destinationEmail && selectedMailbox.email.toLowerCase() !== input.destinationEmail.toLowerCase()) {
      throw new Error(
        `The forward-to address ${input.destinationEmail} is not configured as a mailbox in SimpleLogin.`
      );
    }

    const preview = input.providerHint
      ? {
          providerHint: input.providerHint,
          displaySuffix: "reserved"
        }
      : await this.getAliasPreview();
    if (!preview) {
      throw new Error("No usable alias suffix is available on your SimpleLogin account.");
    }

    log.debug(
      {
        localPart: input.localPart,
        suffix: preview.displaySuffix,
        mailboxId: selectedMailbox.id,
        mailboxEmail: selectedMailbox.email
      },
      "Creating SimpleLogin alias"
    );

    const alias = await this.slFetch<SlAlias>("/api/v3/alias/custom/new", {
      method: "POST",
      body: JSON.stringify({
        alias_prefix: input.localPart,
        signed_suffix: preview.providerHint,
        mailbox_ids: [selectedMailbox.id],
        note: input.note ?? input.label ?? null
      })
    });

    return {
      id: String(alias.id),
      email: alias.email,
      destinationEmail: selectedMailbox.email,
      enabled: alias.enabled,
      label: extractLabelFromProviderNote(input.note ?? input.label ?? null)
    };
  }

  async disableAlias(providerAliasId: string): Promise<void> {
    await this.ensureAliasState(providerAliasId, false);
  }

  async updateAliasMetadata(providerAliasId: string, input: UpdateProviderAliasMetadataInput): Promise<void> {
    let mailboxIds: number[] | undefined;

    if (input.destinationEmail) {
      const { mailboxes } = await this.listMailboxes();
      const selectedMailbox = mailboxes.find(
        (mailbox) => mailbox.email.toLowerCase() === input.destinationEmail?.toLowerCase()
      );

      if (!selectedMailbox) {
        throw new Error(
          `The forward-to address ${input.destinationEmail} is not configured as a mailbox in SimpleLogin.`
        );
      }

      mailboxIds = [selectedMailbox.id];
    }

    await this.slFetch(`/api/aliases/${providerAliasId}`, {
      method: "PATCH",
      body: JSON.stringify({
        note: input.note ?? null,
        ...(mailboxIds ? { mailbox_ids: mailboxIds } : {})
      })
    });
  }

  async enableAlias(providerAliasId: string): Promise<void> {
    await this.ensureAliasState(providerAliasId, true);
  }

  async deleteAlias(providerAliasId: string): Promise<void> {
    await this.slFetch(`/api/aliases/${providerAliasId}`, { method: "DELETE" });
  }

  async listAliases(): Promise<ProviderAlias[]> {
    const data = await this.slFetch<SlAliasList>("/api/v2/aliases?page_id=0");
    return data.aliases.map((alias) => ({
      id: String(alias.id),
      email: alias.email,
      destinationEmail: alias.mailboxes?.[0]?.email ?? "",
      enabled: alias.enabled,
      label: extractLabelFromProviderNote(alias.note ?? null)
    }));
  }

  private async ensureAliasState(providerAliasId: string, enabled: boolean): Promise<void> {
    const alias = await this.slFetch<SlAliasDetails>(`/api/aliases/${providerAliasId}`);
    if (alias.enabled === enabled) {
      return;
    }

    await this.slFetch(`/api/aliases/${providerAliasId}/toggle`, {
      method: "POST"
    });
  }

  private async listMailboxes(): Promise<SlMailboxList> {
    return this.slFetch<SlMailboxList>("/api/v2/mailboxes");
  }
}
