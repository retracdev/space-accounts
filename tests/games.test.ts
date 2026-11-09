import { afterAll, beforeAll, expect, it } from "vitest";
import { Miniflare } from "miniflare";
import { build } from "esbuild";
import { readFileSync, readdirSync } from "node:fs";
import { symmetricDecrypt } from "better-auth/crypto";
import { decodeJwt, decodeProtectedHeader, importJWK, SignJWT, generateKeyPair, exportJWK } from "jose";

const origin = "https://accounts.retrac.space";
const secret = crypto.randomUUID() + crypto.randomUUID();
const serviceKey = crypto.randomUUID() + crypto.randomUUID();
let mf: Miniflare;
let cookie: string;
let token: string;
let id: string;
const password = "A test password for games 429!";
function auth(path: string, body?: object, originHeader = origin) {
  return mf.dispatchFetch(origin + "/api/auth/" + path, {
    method: body ? "POST" : "GET",
    headers: { Origin: originHeader, Cookie: cookie ?? "", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}
function internal(path: string, body: object = {}, accessToken = token, headers = {}) {
  return mf.dispatchFetch(origin + "/api/internal/games/" + path, {
    method: "POST", headers: { "X-Space-Api-Key": serviceKey, Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
  });
}
beforeAll(async () => {
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  const output = await build({ entryPoints: ["src/server/worker.ts"], bundle: true, write: false,
    format: "esm", platform: "neutral", target: "es2022", conditions: ["workerd", "worker", "browser"],
    external: ["node:*", "cloudflare:*"] });
  mf = new Miniflare({ modules: true, script: output.outputFiles[0].text,
    compatibilityDate: "2026-07-01", compatibilityFlags: ["nodejs_compat"], d1Databases: ["DB"],
    bindings: { BETTER_AUTH_URL: origin, BETTER_AUTH_SECRET: secret, ACCOUNTS_API_KEY: serviceKey,
      GAME_JWT_PRIVATE_KEY: JSON.stringify(await exportJWK(privateKey)),
      GAME_AUTH_ORIGINS: "https://chess.retrac.space" },
    serviceBindings: { ASSETS: () => new Response("assets") } });
  const db = await mf.getD1Database("DB");
  for (const file of readdirSync("migrations").filter((f) => f.endsWith(".sql")))
    for (const statement of readFileSync(`migrations/${file}`, "utf8").split("--> statement-breakpoint"))
      await db.prepare(statement).run();
  const signup = await auth("sign-up/email", { email: "games@example.test", name: "Player", password, username: "game_player" });
  expect(signup.status).toBe(200);
  cookie = signup.headers.get("set-cookie")!.split(";")[0];
  id = ((await signup.json()) as { user: { id: string } }).user.id;
});
afterAll(async () => { await mf?.dispose(); });

it("issues minimal five-minute tokens only for real sessions, with narrowly scoped CORS", async () => {
  const result = await auth("token", undefined, "https://chess.retrac.space");
  expect(result.status).toBe(200);
  expect(result.headers.get("access-control-allow-origin")).toBe("https://chess.retrac.space");
  token = ((await result.json()) as { token: string }).token;
  expect(decodeProtectedHeader(token).alg).toBe("ES256");
  const claims = decodeJwt(token);
  expect(Object.keys(claims).sort()).toEqual(["aud", "exp", "iat", "iss", "sid", "sub"]);
  expect(claims).toMatchObject({ sub: id, iss: origin, aud: "https://api.retrac.space" });
  expect(claims.exp! - claims.iat!).toBe(300);
  expect((await internal("session")).status).toBe(200);
  expect((await auth("token", undefined, "https://evil.test")).status).toBe(403);
  const guest = await mf.dispatchFetch(origin + "/api/auth/token");
  expect(guest.status).toBe(401);
  const greeting = await auth("get-session", undefined, "https://retrac.space");
  expect(greeting.headers.get("set-auth-jwt")).toBeNull();
  expect(await greeting.json()).toEqual({
    user: { username: "game_player" },
    actionRequired: { required: false, reason: null, url: null },
  });
});

it("requires service authorization, rejects browser origins, and bounds directory queries", async () => {
  for (const headers of [{ "X-Space-Api-Key": "wrong" }, { Origin: "https://chess.retrac.space" }]) {
    const response = await internal("players", { ids: [id] }, token, headers);
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
  }
  expect((await internal("players", { ids: Array(101).fill(id) })).status).toBe(400);
  expect(await (await internal("players", { ids: [id, id, "missing"] })).json())
    .toEqual([{ id, username: "game_player" }]);
});

it("rejects invalid, expired, wrong-audience and overlong tokens", async () => {
  const db = await mf.getD1Database("DB");
  const row = await db.prepare("SELECT * FROM jwks LIMIT 1").first<{ private_key: string; id: string }>();
  const jwk = JSON.parse(await symmetricDecrypt({ key: secret, data: JSON.parse(row!.private_key) }));
  const key = await importJWK(jwk, "ES256");
  const now = Math.floor(Date.now() / 1000);
  const claims = decodeJwt(token);
  for (const changed of [
    { iat: now - 400, exp: now - 100 }, { aud: "https://evil.test" },
    { exp: now + 600 }, { sid: "missing" }, { sub: "someone-else" },
  ]) {
    const forged = await new SignJWT({ ...claims, ...changed }).setProtectedHeader({ alg: "ES256", kid: row!.id }).sign(key);
    expect((await internal("session", {}, forged)).status).toBe(401);
  }
  expect((await internal("session", {}, "invalid")).status).toBe(401);
  const parts = token.split(".");
  parts[2] = (parts[2][0] === "A" ? "B" : "A") + parts[2].slice(1);
  expect((await internal("session", {}, parts.join("."))).status).toBe(401);
});

it("uses live usernames and immediately rejects expired/revoked sessions and deleted users", async () => {
  expect((await auth("update-user", { username: "renamed_player" })).status).toBe(200);
  expect(await (await internal("session")).json()).toEqual({ id, username: "renamed_player" });
  expect(await (await internal("players", { username: "game_player" })).json()).toEqual([]);
  const db = await mf.getD1Database("DB");
  const sid = decodeJwt(token).sid;
  await db.prepare("UPDATE session SET expires_at=? WHERE id=?").bind(Date.now() - 1000, sid).run();
  expect((await internal("session")).status).toBe(401);
  await db.prepare("UPDATE session SET expires_at=? WHERE id=?").bind(Date.now() + 600000, sid).run();
  expect((await auth("sign-out", {})).status).toBe(200);
  expect((await internal("session")).status).toBe(401);
  const login = await auth("sign-in/email", { email: "games@example.test", password });
  cookie = login.headers.get("set-cookie")!.split(";")[0];
  token = ((await (await auth("token")).json()) as { token: string }).token;
  expect((await auth("delete-user", { password })).status).toBe(200);
  expect((await internal("session")).status).toBe(401);
  expect(await (await internal("players", { ids: [id] })).json()).toEqual([]);
});
