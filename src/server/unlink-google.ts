import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, getSessionFromCtx } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";

export const unlinkGoogleReason = "auth_unlink_google";
export const unlinkGooglePath = "/unlink-google-required-setpw";

type Flagged = { id: string; action_required_reason: string | null };

// Accounts flagged with auth_unlink_google must move from Google sign-in to a password.
// Deliberate operator decision: a flagged account can be signed in by username/email
// alone so a locked-out owner can reach the set-password page. Only flagged accounts
// are affected, and the flag is cleared as soon as a password is set.
export function unlinkGoogle(db: D1Database) {
  return {
    id: "unlink-google",
    endpoints: {
      unlinkGoogleIdentify: createAuthEndpoint(
        "/unlink-google/identify",
        { method: "POST" },
        async (ctx) => {
          const identifier = String(
            (ctx.body as { identifier?: unknown } | undefined)?.identifier ?? "",
          ).trim().toLowerCase();
          if (!identifier || identifier.length > 254)
            throw new APIError("BAD_REQUEST", { message: "Enter your username or email." });
          const row = await db.prepare(
            'SELECT id, action_required_reason FROM "user" WHERE lower(email) = ? OR lower(username) = ? LIMIT 1',
          ).bind(identifier, identifier).first<Flagged>();
          // Every other account (or no account) gets the same answer: continue to the password step.
          if (!row || row.action_required_reason !== unlinkGoogleReason)
            return ctx.json({ signedIn: false });
          const user = await ctx.context.internalAdapter.findUserById(row.id);
          if (!user) return ctx.json({ signedIn: false });
          const session = await ctx.context.internalAdapter.createSession(user.id);
          if (!session)
            throw new APIError("SERVICE_UNAVAILABLE", { message: "Please try again." });
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ signedIn: true, redirect: unlinkGooglePath });
        },
      ),
      unlinkGoogleSetPassword: createAuthEndpoint(
        "/unlink-google/set-password",
        { method: "POST" },
        async (ctx) => {
          const session = await getSessionFromCtx(ctx);
          if (!session)
            throw new APIError("UNAUTHORIZED", { message: "Sign in again to continue." });
          const password = String(
            (ctx.body as { newPassword?: unknown } | undefined)?.newPassword ?? "",
          );
          if (password.length < 7 || password.length > 128)
            throw new APIError("BAD_REQUEST", { message: "Use 7 to 128 characters for your password." });
          const row = await db.prepare(
            'SELECT id, action_required_reason FROM "user" WHERE id = ?',
          ).bind(session.user.id).first<Flagged>();
          if (row?.action_required_reason !== unlinkGoogleReason)
            throw new APIError("BAD_REQUEST", { message: "This account does not need a new password." });

          const hash = await ctx.context.password.hash(password);
          const accounts = await ctx.context.internalAdapter.findAccounts(session.user.id);
          if (accounts.some((a) => a.providerId === "credential"))
            await ctx.context.internalAdapter.updatePassword(session.user.id, hash);
          else
            await ctx.context.internalAdapter.linkAccount({
              userId: session.user.id,
              providerId: "credential",
              accountId: session.user.id,
              password: hash,
            });

          await db.batch([
            db.prepare('DELETE FROM "account" WHERE user_id = ? AND provider_id = ?')
              .bind(session.user.id, "google"),
            db.prepare(
              'UPDATE "user" SET action_required = 0, action_required_reason = NULL, action_required_url = NULL, updated_at = ? WHERE id = ? AND action_required_reason = ?',
            ).bind(Date.now(), session.user.id, unlinkGoogleReason),
          ]);
          return ctx.json({
            status: true,
            username: (session.user as { username?: string | null }).username ?? null,
            email: session.user.email,
          });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
