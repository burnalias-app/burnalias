import { ConfiguredProvider, ProviderType, SupportedProviderDefinition } from "../api";

export function panelClassName(extra?: string): string {
  return [
    "rounded-[1.6rem] border border-white/10 bg-[#0f141c]/82 shadow-[0_28px_90px_rgba(0,0,0,0.42)] backdrop-blur",
    extra ?? ""
  ]
    .join(" ")
    .trim();
}

export function fieldClassName(): string {
  return "w-full rounded-[1.1rem] border border-white/10 bg-[#141b24] px-4 py-3 text-slate-100 outline-none transition focus:border-[#d7a968]/50 focus:ring-2 focus:ring-[#d7a968]/20";
}

export function formatDate(value: string | null): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function formatInterval(intervalMs: number): string {
  if (intervalMs % (24 * 60 * 60 * 1000) === 0) {
    const days = intervalMs / (24 * 60 * 60 * 1000);
    return `${days} day${days === 1 ? "" : "s"}`;
  }

  if (intervalMs % (60 * 60 * 1000) === 0) {
    const hours = intervalMs / (60 * 60 * 1000);
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }

  if (intervalMs % (60 * 1000) === 0) {
    const minutes = intervalMs / (60 * 1000);
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  const seconds = Math.max(1, Math.round(intervalMs / 1000));
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

export function getCountdown(expiresAt: string | null): string {
  if (!expiresAt) return "No expiration";
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return "Expired";
  const totalMinutes = Math.floor(diff / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  return days > 0 ? `${days}d ${hours}h remaining` : `${Math.max(hours, 0)}h remaining`;
}

const aliasWords = ["cedar", "ember", "atlas", "harbor", "comet", "clover", "solace", "drift", "mosaic", "lumen"];

export function randomAliasName(): string {
  return aliasWords[Math.floor(Math.random() * aliasWords.length)];
}

export function makeProviderId(type: ProviderType): string {
  return `provider-${type}-${crypto.randomUUID().slice(0, 8)}`;
}

export function buildProviderDraft(
  type: ProviderType,
  supportedProvider?: SupportedProviderDefinition
): ConfiguredProvider {
  const shared = {
    id: makeProviderId(type),
    name: supportedProvider?.label ?? type
  };

  if (type === "simplelogin") {
    return {
      ...shared,
      type,
      config: {
        apiKey: "",
        hasStoredSecret: false,
        clearStoredSecret: false,
        lastConnectionTestSucceededAt: null
      }
    };
  }

  if (type === "addy") {
    return {
      ...shared,
      type,
      config: {
        apiKey: "",
        hasStoredSecret: false,
        clearStoredSecret: false,
        lastConnectionTestSucceededAt: null,
        lastConnectionTestVerificationToken: null
      }
    };
  }

  return {
    ...shared,
    type,
    config: {
      apiKey: "",
      hasStoredSecret: false,
      clearStoredSecret: false,
      lastConnectionTestSucceededAt: null,
      lastConnectionTestVerificationToken: null
    }
  };
}

export function configuredProviderLabel(
  provider: ConfiguredProvider,
  supportedProviders: SupportedProviderDefinition[]
): string {
  return supportedProviders.find((item) => item.type === provider.type)?.label ?? provider.type;
}
