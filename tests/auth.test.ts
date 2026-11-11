import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Miniflare } from "miniflare";
import { build } from "esbuild";
import { rawText } from "../esbuild-raw";
import { readFileSync, readdirSync } from "node:fs";

const origin = "https://accounts.retrac.space";
let mf: Miniflare;
let ip = 0;
let cookie = "";
const password = "A long local password 429!";
async function request(
  path: string,
  body?: object,
  options: { cookie?: string; origin?: string; ip?: string } = {},
) {
  return mf.dispatchFetch(origin + "/api/auth" + path, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      Origin: options.origin ?? origin,
      "cf-connecting-ip": options.ip ?? `192.0.2.${++ip}`,
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
}
beforeAll(async () => {
  const output = await build({
    entryPoints: ["src/server/worker.ts"],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    conditions: ["workerd", "worker", "browser"],
    external: ["node:*", "cloudflare:*"],
    plugins: [rawText],
  });
  mf = new Miniflare({
    modules: true,
    script: output.outputFiles[0].text,
    compatibilityDate: "2026-07-01",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: ["DB"],
    bindings: {
      BETTER_AUTH_URL: origin,
      BETTER_AUTH_SECRET: crypto.randomUUID() + crypto.randomUUID(),
    },
    serviceBindings: { ASSETS: () => new Response("assets") },
  });
  const db = await mf.getD1Database("DB");
  for (const file of readdirSync("migrations").filter((name) =>
    name.endsWith(".sql"),
  )) {
    const statements = readFileSync(`migrations/${file}`, "utf8").split(
      "--> statement-breakpoint",
    );
    for (const statement of statements) await db.prepare(statement).run();
  }
}, 60000);
afterAll(async () => {
  await mf?.dispose();
});

describe("Worker authentication with real D1", () => {
  it("returns a normal guest state without redirecting anonymous requests", async () => {
    const response = await request("/get-session");
    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
    expect(response.headers.get("location")).toBeNull();
    const invalid = await request("/get-session", undefined, {
      cookie: "__Secure-retrac-space.session_token=invalid",
    });
    expect(invalid.status).toBe(200);
    expect(await invalid.json()).toBeNull();
  });
  it("rejects cross-site and sibling-origin mutations", async () => {
    for (const origin of [
      "https://evil.test",
      "https://chess.retrac.space",
      "null",
    ]) {
      expect((await request("/sign-up/email", {}, { origin })).status).toBe(
        403,
      );
    }
    const missing = await mf.dispatchFetch(origin + "/api/auth/sign-out", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(missing.status).toBe(403);
  });
  it("still rejects anonymous changes to protected account data", async () => {
    expect(
      (await request("/update-user", { username: "guest_player" })).status,
    ).toBe(401);
    expect((await request("/delete-user", {})).status).toBe(401);
  });
  it("refuses noncanonical hosts and does not expose wildcard CORS", async () => {
    expect(
      (
        await mf.dispatchFetch(
          "https://space-accounts.pages.dev/api/auth/get-session",
        )
      ).status,
    ).toBe(404);
    const response = await request("/get-session", undefined, {
      origin: "https://evil.test",
    });
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
  });
  it("requires a username and rejects reserved names", async () => {
    for (const username of [undefined, "ADMIN", "ab", "bad.name"]) {
      const response = await request("/sign-up/email", {
        email: "invalid@example.test",
        name: "Player",
        password,
        username,
      });
      expect(response.status).toBe(400);
    }
    expect(
      (
        await request("/sign-up/email", {
          email: "short@example.test",
          name: "Short",
          username: "short_player",
          password: "short",
        })
      ).status,
    ).toBe(400);
  });
  it("registers without verification and immediately allows password login", async () => {
    const response = await request("/sign-up/email", {
      email: "player@example.test",
      name: "Player",
      password,
      username: "Player_One",
      callbackURL: "/sign-in",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      user: { emailVerified: false, username: "player_one" },
    });
    expect(
      (await request("/sign-in/username", { username: "player_one", password }))
        .status,
    ).toBe(200);
  });
  it("enforces case-insensitive uniqueness in signup and database", async () => {
    expect(
      (
        await request("/sign-up/email", {
          email: "duplicate@example.test",
          name: "Other",
          password,
          username: "PLAYER_ONE",
        })
      ).status,
    ).toBe(400);
    const db = await mf.getD1Database("DB");
    await expect(
      db
        .prepare(
          "INSERT INTO user (id, name, email, email_verified, created_at, updated_at, username) VALUES ('duplicate','Other','db@example.test',1,0,0,'PLAYER_ONE')",
        )
        .run(),
    ).rejects.toThrow();
  });
  it("issues a secure host-only session", async () => {
    const response = await request("/sign-in/username", {
      username: "PLAYER_ONE",
      password,
    });
    expect(response.status).toBe(200);
    const setCookie = response.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).not.toMatch(/Domain=/i);
    cookie = setCookie.split(";")[0];
    const session = await request("/get-session", undefined, { cookie });
    expect(
      ((await session.json()) as { user: { username: string } }).user.username,
    ).toBe("player_one");
  });
  it("renames usernames and checks availability", async () => {
    expect(
      (await request("/update-user", { username: "new_player" }, { cookie }))
        .status,
    ).toBe(200);
    const response = await request("/is-username-available", {
      username: "NEW_PLAYER",
    });
    expect(await response.json()).toMatchObject({ available: false });
    expect(
      (await request("/update-user", { username: "support" }, { cookie }))
        .status,
    ).toBe(400);
    expect(
      (await request("/update-user", { username: null }, { cookie })).status,
    ).toBe(400);
  });
  it("allows a pending OAuth identity to choose a username and enforces fresh deletion", async () => {
    const db = await mf.getD1Database("DB");
    // Establish a signed session using Better Auth, then seed the persisted shape of a Google callback.
    // Real provider consent/network behavior is a separate deployment acceptance check.
    const signedIn = await request("/sign-up/email", {
      email: "google@example.test",
      name: "Google Player",
      username: "before_google",
      password,
    });
    const googleCookie = signedIn.headers.get("set-cookie")!.split(";")[0];
    await db
      .prepare(
        "UPDATE account SET provider_id='google', account_id='test-google-subject', password=NULL WHERE user_id=(SELECT id FROM user WHERE email='google@example.test')",
      )
      .run();
    await db
      .prepare(
        "UPDATE user SET username=NULL, email_verified=1 WHERE email='google@example.test'",
      )
      .run();
    const pending = await request("/get-session", undefined, {
      cookie: googleCookie,
    });
    expect(
      ((await pending.json()) as { user: { username: null } }).user.username,
    ).toBeNull();
    expect(
      (
        await request(
          "/update-user",
          { username: "google_player" },
          { cookie: googleCookie },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          "/change-email",
          { newEmail: "other-google@example.test" },
          { cookie: googleCookie },
        )
      ).status,
    ).toBe(400);
    await db
      .prepare(
        "UPDATE session SET created_at=? WHERE user_id=(SELECT id FROM user WHERE email='google@example.test')",
      )
      .bind(Date.now() - 11 * 60 * 1000)
      .run();
    expect(
      (await request("/delete-user", {}, { cookie: googleCookie })).status,
    ).not.toBe(200);
    await db
      .prepare(
        "UPDATE session SET created_at=? WHERE user_id=(SELECT id FROM user WHERE email='google@example.test')",
      )
      .bind(Date.now())
      .run();
    expect(
      (await request("/delete-user", {}, { cookie: googleCookie })).status,
    ).toBe(200);
  });
  it("supports email/password login without verifying email", async () => {
    expect(
      (
        await request("/sign-in/email", {
          email: "player@example.test",
          password,
        })
      ).status,
    ).toBe(200);
  });
  it("changes email only after password confirmation", async () => {
    expect(
      (
        await request(
          "/change-email",
          { newEmail: "renamed@example.test" },
          { cookie },
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          "/change-email",
          { newEmail: "renamed@example.test", password: "incorrect" },
          { cookie },
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          "/change-email",
          { newEmail: "renamed@example.test", password },
          { cookie },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request("/sign-in/email", {
          email: "renamed@example.test",
          password,
        })
      ).status,
    ).toBe(200);
  });
  it("has no email delivery or recovery routes", async () => {
    for (const path of [
      "/request-password-reset",
      "/reset-password",
      "/send-verification-email",
      "/verify-email",
    ]) {
      expect((await request(path, {})).status).toBe(404);
    }
  });
  it("rate limits repeated sign-in attempts across Worker requests", async () => {
    let response;
    for (let i = 0; i < 6; i++)
      response = await request(
        "/sign-in/username",
        { username: "missing_player", password },
        { ip: "198.51.100.10" },
      );
    expect(response!.status).toBe(429);
  });
  it("changes password and revokes other sessions", async () => {
    const second = await request("/sign-in/username", {
      username: "new_player",
      password,
    });
    const otherCookie = second.headers.get("set-cookie")!.split(";")[0];
    const changed = await request(
      "/change-password",
      {
        currentPassword: password,
        newPassword: password + " new",
        revokeOtherSessions: true,
      },
      { cookie },
    );
    expect(changed.status).toBe(200);
    cookie = changed.headers.get("set-cookie")?.split(";")[0] ?? cookie;
    expect(
      await (
        await request("/get-session", undefined, { cookie: otherCookie })
      ).json(),
    ).toBeNull();
    expect(
      (await request("/sign-in/username", { username: "new_player", password }))
        .status,
    ).not.toBe(200);
  });
  it("requires a password for credential account deletion, even with a fresh session", async () => {
    expect((await request("/delete-user", {}, { cookie })).status).toBe(400);
  });
  it("signs out and invalidates the session in D1", async () => {
    const response = await request("/sign-in/username", {
      username: "new_player",
      password: password + " new",
    });
    const activeCookie = response.headers.get("set-cookie")!.split(";")[0];
    expect(
      (await request("/sign-out", {}, { cookie: activeCookie })).status,
    ).toBe(200);
    expect(
      await (
        await request("/get-session", undefined, { cookie: activeCookie })
      ).json(),
    ).toBeNull();
  });
  it("deletes the account and cascading session and provider data after confirmation", async () => {
    const signedIn = await request("/sign-in/username", {
      username: "new_player",
      password: password + " new",
    });
    const activeCookie = signedIn.headers.get("set-cookie")!.split(";")[0];
    const deletion = await request(
      "/delete-user",
      { password: password + " new" },
      { cookie: activeCookie },
    );
    expect(deletion.status).toBe(200);
    expect(
      await (
        await request("/get-session", undefined, { cookie: activeCookie })
      ).json(),
    ).toBeNull();
    const db = await mf.getD1Database("DB");
    expect(
      await db
        .prepare("SELECT id FROM user WHERE username='new_player'")
        .first(),
    ).toBeNull();
    expect(
      await db
        .prepare("SELECT id FROM account WHERE provider_id='credential'")
        .first(),
    ).toBeNull();
  });
});
