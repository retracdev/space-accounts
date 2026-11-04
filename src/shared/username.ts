export const USERNAME_HELP =
  "3–20 characters. Use letters, numbers, and underscores.";
const reserved = new Set([
  "admin",
  "administrator",
  "accounts",
  "api",
  "auth",
  "support",
  "retracdev",
  "retraclabs",
  "system",
  "moderator",
  "root",
  "security",
]);
export function validUsername(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    /^[a-zA-Z0-9_]{3,20}$/.test(value) &&
    !reserved.has(normalized) &&
    (normalized === "retrac" || !normalized.includes("retrac"))
  );
}
