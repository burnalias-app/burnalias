export function buildProviderNote(label: string | null | undefined, expiresAt: string | null): string | null {
  const parts: string[] = [];

  if (label) {
    parts.push(`Label: ${label}`);
  }

  if (expiresAt) {
    parts.push(`BurnAlias expiration: ${expiresAt}`);
  }

  return parts.length > 0 ? parts.join(" | ") : null;
}

export function extractLabelFromProviderNote(note: string | null | undefined): string | null {
  if (!note) {
    return null;
  }

  const parts = note
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !part.startsWith("BurnAlias expiration:"))
    .map((part) => (part.startsWith("Label:") ? part.slice("Label:".length).trim() : part))
    .filter(Boolean);

  return parts.length > 0 ? parts.join(" | ") : null;
}
