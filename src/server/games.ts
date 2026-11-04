import { timingSafeEqual } from "node:crypto";
import { createLocalJWKSet, errors, jwtVerify } from "jose";
import { and, eq, gt, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { createAuth, type Env } from "./auth";
import { user, session } from "./schema";

const issuer = "https://accounts.retrac.space";
const audience = "https://api.retrac.space";
const identity = { id: user.id, username: user.username };
const fail = (status: number) => Response.json({ message: "Game authentication request failed." }, { status });

// No game is trusted by default. Configure only reviewed, exact HTTPS origins.
export function gameOrigins(env: Env): string[] {
  return (env.GAME_AUTH_ORIGINS ?? "").split(",").filter(Boolean).map((value) => {
    const origin = value.trim();
    const url = new URL(origin);
    if (url.origin !== origin || url.protocol !== "https:" || url.hostname === "retrac.space" ||
        !url.hostname.endsWith(".retrac.space")) throw new Error("Invalid game origin");
    return origin;
  });
}

async function body(request: Request): Promise<Record<string, unknown> | null> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 32768) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch { return null; }
}

export async function internalGames(request: Request, env: Env): Promise<Response> {
  if (request.headers.has("origin")) return fail(403);
  if (request.method !== "POST") return fail(405);
  const path = new URL(request.url).pathname;
  if (!['/api/internal/games/session', '/api/internal/games/players'].includes(path)) return fail(404);
  if (!env.ACCOUNTS_API_KEY || new TextEncoder().encode(env.ACCOUNTS_API_KEY).length < 32 ||
      env.ACCOUNTS_API_KEY === env.BETTER_AUTH_SECRET) return fail(503);
  const supplied = request.headers.get("x-space-api-key") ?? "";
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  if (!timingSafeEqual(await digest(supplied), await digest(env.ACCOUNTS_API_KEY))) return fail(403);

  // Atomic, bounded per-source counters in the existing Better Auth rate-limit table.
  const now = Date.now();
  const limit = await env.DB.prepare(`INSERT INTO rate_limit (id, key, count, last_request)
    VALUES (?, ?, 1, ?) ON CONFLICT(key) DO UPDATE SET
    count = CASE WHEN last_request <= ? THEN 1 ELSE count + 1 END,
    last_request = CASE WHEN last_request <= ? THEN excluded.last_request ELSE last_request END
    RETURNING count`).bind(
      crypto.randomUUID(), `games:${request.headers.get("cf-connecting-ip") ?? "service"}`,
      now, now - 60000, now - 60000,
    ).first<{ count: number }>();
  if (!limit || limit.count > 600) return fail(429);
  const data = await body(request);
  if (!data) return fail(400);
  const db = drizzle(env.DB);
  if (path.endsWith("/players")) {
    if (Object.keys(data).length !== 1) return fail(400);
    if (Array.isArray(data.ids) && data.ids.length <= 100 && data.ids.every(
      (id) => typeof id === "string" && id.length > 0 && id.length <= 256,
    )) {
      const ids = [...new Set(data.ids as string[])];
      return Response.json(ids.length ? await db.select(identity).from(user).where(inArray(user.id, ids)) : []);
    }
    if (typeof data.username === "string" && /^[a-z0-9_]{3,20}$/.test(data.username))
      return Response.json(await db.select(identity).from(user).where(eq(user.username, data.username)));
    return fail(400);
  }
  if (Object.keys(data).length) return fail(400);
  const auth = request.headers.get("authorization") ?? "";
  if (!/^Bearer [^\s]{1,8192}$/.test(auth)) return fail(401);
  // Fetch locally through the plugin, never a request-controlled URL or remote JWKS.
  const keys = await createAuth(env).api.getJwks();
  let claims;
  try {
    ({ payload: claims } = await jwtVerify(auth.slice(7), createLocalJWKSet(keys), {
      algorithms: ["ES256"], issuer, audience, maxTokenAge: "5m",
      requiredClaims: ["sub", "sid", "iat", "exp"],
    }));
  } catch (error) {
    if (error instanceof errors.JOSEError) return fail(401);
    throw error;
  }
  if (typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 256 ||
      typeof claims.sid !== "string" || !claims.sid || claims.sid.length > 256 ||
      typeof claims.iat !== "number" || typeof claims.exp !== "number" ||
      claims.exp <= claims.iat || claims.exp - claims.iat > 300) return fail(401);
  const current = await db.select(identity).from(session).innerJoin(user, eq(session.userId, user.id))
    .where(and(eq(session.id, claims.sid), eq(session.userId, claims.sub), gt(session.expiresAt, new Date()))).get();
  return current ? Response.json(current) : fail(401);
}
