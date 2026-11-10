import { APIError } from "better-auth/api";
import { validUsername } from "../shared/username";

export const inappropriateUsernameAction = {
  actionRequired: true,
  actionRequiredReason: "inappropriate_username",
  actionRequiredUrl: "https://accounts.retrac.space/change-username-required-1",
};

export async function containsProfanity(username: string): Promise<boolean> {
  try {
    const url = new URL("https://www.purgomalum.com/service/containsprofanity");
    url.searchParams.set("text", username);
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("Moderation unavailable");
    const result = (await response.text()).trim();
    if (result === "true") return true;
    if (result === "false") return false;
  } catch {
    // Fail closed: leave the account unchanged, without flagging an outage as profanity.
  }
  throw new APIError("SERVICE_UNAVAILABLE", {
    message: "Unable to save your username right now. Please try again.",
  });
}

export async function generateUsername(db: D1Database): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const username = `user${10000 + Math.floor(Math.random() * 90000)}`;
    const existing = await db.prepare(
      'SELECT id FROM "user" WHERE lower(username) = ? LIMIT 1',
    ).bind(username).first();
    if (!existing) return username;
  }
  throw new APIError("SERVICE_UNAVAILABLE", {
    message: "Unable to assign a username. Please try again.",
  });
}

type UsernameState = {
  username: string | null;
  display_username: string | null;
  updated_at: number;
  action_required: number;
  action_required_reason: string | null;
  action_required_url: string | null;
};

export async function updateUsername(
  db: D1Database,
  userId: string,
  requested: unknown,
  resolve: boolean,
  profile: { name?: string; image?: string | null },
) {
  if (typeof requested !== "string" || !validUsername(requested))
    throw new APIError("BAD_REQUEST", { message: "Choose a valid username." });

  // Capture the state BEFORE the network call. Compare it in the write itself.
  const previous = await db.prepare(
    'SELECT username, display_username, updated_at, action_required, action_required_reason, action_required_url FROM "user" WHERE id = ?',
  ).bind(userId).first<UsernameState>();
  if (!previous) throw new APIError("UNAUTHORIZED", { message: "Sign in again to continue." });
  const restricted = previous.action_required_reason === "inappropriate_username";
  if (resolve && !restricted)
    throw new APIError("BAD_REQUEST", { message: "This account issue cannot be resolved here." });
  if (resolve && requested.toLowerCase() === previous.username?.toLowerCase())
    throw new APIError("BAD_REQUEST", { message: "Please choose a different username." });

  const profane = await containsProfanity(requested);
  if (profane && resolve)
    throw new APIError("BAD_REQUEST", { message: "This username is not allowed. Please choose another." });

  for (let attempt = 0; attempt < 100; attempt++) {
    const display = profane ? await generateUsername(db) : requested;
    const username = display.toLowerCase();
    // Preserve unrelated restrictions, including ones applied while moderation was pending.
    const setAction = profane && (!previous.action_required_reason || restricted);
    const clearAction = resolve && restricted;
    const assignments = [
      "username = ?", "display_username = ?", "updated_at = ?",
      ...(setAction || clearAction ? ["action_required = ?", "action_required_reason = ?", "action_required_url = ?"] : []),
      ...(profile.name !== undefined ? ["name = ?"] : []),
      ...(profile.image !== undefined ? ["image = ?"] : []),
    ];
    const values = [
      username, display, Math.max(Date.now(), previous.updated_at + 1),
      ...(setAction ? [1, inappropriateUsernameAction.actionRequiredReason, inappropriateUsernameAction.actionRequiredUrl] : clearAction ? [0, null, null] : []),
      ...(profile.name !== undefined ? [profile.name] : []),
      ...(profile.image !== undefined ? [profile.image] : []),
    ];
    try {
      const result = await db.prepare(
        `UPDATE "user" SET ${assignments.join(", ")} WHERE id = ? AND username IS ? AND display_username IS ? AND updated_at = ? AND action_required = ? AND action_required_reason IS ? AND action_required_url IS ?`,
      ).bind(...values, userId, previous.username, previous.display_username, previous.updated_at,
        previous.action_required, previous.action_required_reason, previous.action_required_url).run();
      if (!result.meta.changes)
        throw new APIError("CONFLICT", { message: "Your account changed. Refresh and try again." });
      return;
    } catch (error) {
      // The unique index is authoritative, including concurrent assignments.
      const collision = await db.prepare(
        'SELECT id FROM "user" WHERE lower(username) = ? AND id != ? LIMIT 1',
      ).bind(username, userId).first();
      if (!collision) throw error;
      if (!profane)
        throw new APIError("BAD_REQUEST", { message: "That username is taken." });
    }
  }
  throw new APIError("SERVICE_UNAVAILABLE", { message: "Unable to assign a username. Please try again." });
}
