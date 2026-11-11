import source from "../../blacklist-google.yml?raw";

// Reads the comma-separated `domains:` value from blacklist-google.yml.
export function parseBlacklist(text: string): string[] {
  const line = text
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*$/, "").trim())
    .find((l) => /^domains\s*:/i.test(l));
  if (!line) return [];
  return line
    .replace(/^domains\s*:/i, "")
    .replace(/[[\]"']/g, "")
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

export const googleBlacklist = parseBlacklist(source);

export function googleBlocked(email: string | null | undefined): boolean {
  const domain = email?.trim().toLowerCase().split("@")[1];
  if (!domain) return false;
  return googleBlacklist.some((d) => domain === d || domain.endsWith(`.${d}`));
}
