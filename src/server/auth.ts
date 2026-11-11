import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username, jwt } from "better-auth/plugins";
import {
  createAuthMiddleware,
  APIError,
  getSessionFromCtx,
} from "better-auth/api";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";
import { validUsername } from "../shared/username";
import { containsProfanity, generateUsername, inappropriateUsernameAction, updateUsername } from "./usernames";
import { symmetricEncrypt } from "better-auth/crypto";
import { importJWK } from "jose";
import { unlinkGoogle } from "./unlink-google";
import { duplicateGoogle } from "./duplicate-google";
import { googleBlocked } from "../shared/google-blacklist";

// Sign in with Google is refused for domains listed in blacklist-google.yml.
const googleCallback = (
  ctx: { path?: string; params?: Record<string, string | undefined> } | null,
) =>
  ctx?.path === "/callback/:id" && ctx.params?.id === "google";
const blockedGoogleDomain = () =>
  new APIError("FORBIDDEN", {
    message: "Sign in with Google is unavailable for your domain.",
    code: "GOOGLE_DOMAIN_BLOCKED",
  });

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  ACCOUNTS_API_KEY?: string;
  GAME_AUTH_ORIGINS?: string;
  GAME_JWT_PRIVATE_KEY?: string;
}
export function authOrigin(env: Env): string {
  const url = new URL(env.BETTER_AUTH_URL);
  if (
    url.origin !== "https://accounts.retrac.space" &&
    url.origin !== "http://localhost:8788"
  )
    throw new Error("Unsupported account origin");
  if (
    env.BETTER_AUTH_SECRET.length < 32 ||
    env.BETTER_AUTH_SECRET.startsWith("replace-with-")
  )
    throw new Error("Set a random auth secret with at least 32 characters");
  return url.origin;
}
export function createAuth(env: Env) {
  const origin = authOrigin(env);
  const generated = new Set<string>();
  const flagged = new Set<string>();
  const checked = new Set<string>();
  const database = drizzleAdapter(drizzle(env.DB, { schema }), {
    provider: "sqlite",
    schema,
    transaction: false,
  });
  return betterAuth({
    appName: "retrac.space",
    baseURL: origin,
    secret: env.BETTER_AUTH_SECRET,
    logger: { disabled: true },
    database: (options) => {
      const adapter = database(options);
      const create: typeof adapter.create = async (input) => {
        if (input.model !== "user" || !generated.has(String(input.data.username)))
          return adapter.create(input);
        let data = input.data;
        for (let attempt = 0; attempt < 100; attempt++) {
          try {
            return await adapter.create({ ...input, data });
          } catch (error) {
            const collision = await env.DB.prepare(
              'SELECT id FROM "user" WHERE lower(username) = ? LIMIT 1',
            ).bind(String(data.username).toLowerCase()).first();
            if (!collision) throw error;
            const username = await generateUsername(env.DB);
            data = { ...data, username, displayUsername: username };
          }
        }
        throw new APIError("SERVICE_UNAVAILABLE", {
          message: "Unable to assign a username. Please try again.",
        });
      };
      return { ...adapter, create };
    },
    trustedOrigins: [origin],
    disabledPaths: [
      "/request-password-reset",
      "/reset-password",
      "/send-verification-email",
      "/verify-email",
      "/delete-user/callback",
    ],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 7,
      maxPasswordLength: 128,
      requireEmailVerification: false,
    },
    socialProviders:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
            },
          }
        : {},
    account: { accountLinking: { enabled: false }, encryptOAuthTokens: true },
    user: {
      // Clients can read these fields; only trusted server code can set them.
      additionalFields: {
        actionRequired: {
          type: "boolean",
          required: false,
          defaultValue: false,
          input: false,
        },
        actionRequiredReason: { type: "string", required: false, input: false },
        actionRequiredUrl: { type: "string", required: false, input: false },
      },
      changeEmail: { enabled: true, updateEmailWithoutVerification: true },
      deleteUser: { enabled: true },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session, ctx) => {
            if (!googleCallback(ctx)) return;
            const row = await env.DB.prepare('SELECT email FROM "user" WHERE id = ?')
              .bind(session.userId).first<{ email: string }>();
            if (googleBlocked(row?.email)) throw blockedGoogleDomain();
          },
        },
      },
      user: {
        create: {
          before: async (user, ctx) => {
            if (googleCallback(ctx) && googleBlocked(user.email)) throw blockedGoogleDomain();
            const requested = user.username;
            if (requested && !validUsername(requested))
              throw new APIError("BAD_REQUEST", { message: "Choose a valid username." });
            const profane = requested
              ? flagged.has(requested) || (!checked.has(requested) && await containsProfanity(requested))
              : false;
            const display = flagged.has(requested ?? "") ? requested!
              : !requested || profane ? await generateUsername(env.DB) : requested;
            if (!requested || profane) generated.add(display);
            return { data: {
              ...user,
              username: display.toLowerCase(),
              displayUsername: display,
              ...(profane ? inappropriateUsernameAction : {}),
            } };
          },
        },
        update: {
          before: async (user) => {
            // All username writes must use the conditional, moderated write below.
            // This also blocks future/internal adapter paths from bypassing it.
            if ("username" in user || "displayUsername" in user)
              throw new APIError("BAD_REQUEST", {
                message: "Use the username update flow to change your username.",
              });
          },
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      freshAge: 60 * 10,
      cookieCache: { enabled: false },
    },
    advanced: {
      useSecureCookies: origin.startsWith("https:"),
      cookiePrefix: "retrac-space",
      // Host-only session: future games use credentialed requests to this origin.
      crossSubDomainCookies: { enabled: false },
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/*": { window: 60, max: 5 },
        "/sign-up/*": { window: 60, max: 3 },
        "/is-username-available": { window: 60, max: 20 },
        "/update-user": { window: 60, max: 10 },
        "/change-email": { window: 60, max: 5 },
        "/change-password": { window: 60, max: 5 },
        "/delete-user": { window: 60, max: 5 },
        "/unlink-google/identify": { window: 60, max: 10 },
        "/unlink-google/set-password": { window: 60, max: 5 },
        "/duplicate-google-error/dismiss": { window: 60, max: 5 },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (
          ctx.path === "/sign-up/email" &&
          !validUsername(String(ctx.body?.username ?? ""))
        )
          throw new APIError("BAD_REQUEST", {
            message: "Choose a valid username.",
          });
        if (ctx.path === "/sign-up/email" && ctx.body) {
          // Never accept an independently chosen display name.
          const requested = String(ctx.body.username);
          if (await containsProfanity(requested)) {
            const replacement = await generateUsername(env.DB);
            generated.add(replacement);
            flagged.add(replacement);
            ctx.body.username = replacement;
          } else checked.add(requested);
          ctx.body.displayUsername = ctx.body.username;
        }
        if (ctx.path === "/update-user" && ctx.body &&
            ("username" in ctx.body || "displayUsername" in ctx.body ||
             "resolveInappropriateUsername" in ctx.body)) {
          const session = await getSessionFromCtx(ctx);
          if (!session)
            throw new APIError("UNAUTHORIZED", { message: "Sign in again to continue." });
          if (ctx.body.email !== undefined)
            throw new APIError("BAD_REQUEST", { message: "Use the email change flow to change your email." });
          if ((ctx.body.name !== undefined && typeof ctx.body.name !== "string") ||
              (ctx.body.image !== undefined && ctx.body.image !== null && typeof ctx.body.image !== "string"))
            throw new APIError("BAD_REQUEST", { message: "Choose valid profile details." });
          // A display-only update is also a username change, never an unchecked alias.
          await updateUsername(env.DB, session.user.id,
            ctx.body.username ?? ctx.body.displayUsername,
            ctx.body.resolveInappropriateUsername === true,
            { name: ctx.body.name, image: ctx.body.image });
          return ctx.json({ status: true });
        }
        if (ctx.path === "/change-email" || ctx.path === "/delete-user") {
          const session = await getSessionFromCtx(ctx);
          if (!session)
            throw new APIError("UNAUTHORIZED", {
              message: "Sign in again to continue.",
            });
          const account = await ctx.context.internalAdapter.findAccounts(
            session.user.id,
          );
          const credential = account.find((a) => a.providerId === "credential");
          if (credential?.password) {
            const password = String(ctx.body?.password ?? "");
            // Better Auth verifies deletion passwords itself. Email changes need this additional check.
            if (
              !password ||
              password.length > 128 ||
              (ctx.path === "/change-email" &&
                !(await ctx.context.password.verify({
                  hash: credential.password,
                  password,
                })))
            )
              throw new APIError("BAD_REQUEST", {
                message: "Your current password is required.",
              });
          } else if (ctx.path === "/change-email")
            throw new APIError("BAD_REQUEST", {
              message: "Your email is managed by Google.",
            });
        }
      }),
    },
    plugins: [
      unlinkGoogle(env.DB),
      duplicateGoogle(env.DB),
      jwt({
        disableSettingJwtHeader: true,
        jwks: { keyPairConfig: { alg: "ES256" } },
        adapter: {
          // Provision from a Cloudflare secret; keep the plugin's encrypted D1 key storage.
          createJwk: async (data, ctx) => {
            const key = JSON.parse(env.GAME_JWT_PRIVATE_KEY ?? "null");
            if (!key || key.kty !== "EC" || key.crv !== "P-256" ||
                typeof key.d !== "string" || typeof key.x !== "string" || typeof key.y !== "string")
              throw new Error("Configure an ES256 signing key secret");
            const privateJwk = { kty: "EC", crv: "P-256", x: key.x, y: key.y, d: key.d };
            await importJWK(privateJwk, "ES256");
            return ctx.context.adapter.create({
              model: "jwks",
              data: {
                ...data,
                publicKey: JSON.stringify({ kty: "EC", crv: "P-256", x: key.x, y: key.y }),
                privateKey: JSON.stringify(await symmetricEncrypt({
                  key: ctx.context.secretConfig, data: JSON.stringify(privateJwk),
                })),
              },
            });
          },
        },
        jwt: {
          issuer: "https://accounts.retrac.space",
          audience: "https://api.retrac.space",
          expirationTime: "5m",
          definePayload: ({ session }) => ({ sid: session.id }),
        },
      }),
      username({
        minUsernameLength: 3,
        maxUsernameLength: 20,
        usernameValidator: validUsername,
        usernameNormalization: (value) => value.toLowerCase(),
      }),
    ],
  });
}
