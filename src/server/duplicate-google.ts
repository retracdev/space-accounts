import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, getSessionFromCtx } from "better-auth/api";

export const duplicateGoogleReason = "duplicate_google_error";

// Accounts flagged with duplicate_google_error look like duplicates made while the
// owner could not reach their Google-linked account. The owner may dismiss the flag
// to keep using this account instead.
export function duplicateGoogle(db: D1Database) {
  return {
    id: "duplicate-google",
    endpoints: {
      duplicateGoogleDismiss: createAuthEndpoint(
        "/duplicate-google-error/dismiss",
        { method: "POST" },
        async (ctx) => {
          const session = await getSessionFromCtx(ctx);
          if (!session)
            throw new APIError("UNAUTHORIZED", { message: "Sign in again to continue." });
          const result = await db.prepare(
            'UPDATE "user" SET action_required = 0, action_required_reason = NULL, action_required_url = NULL, updated_at = ? WHERE id = ? AND action_required_reason = ?',
          ).bind(Date.now(), session.user.id, duplicateGoogleReason).run();
          if (!result.meta.changes)
            throw new APIError("BAD_REQUEST", { message: "This account has no duplicate account notice." });
          return ctx.json({ status: true });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
