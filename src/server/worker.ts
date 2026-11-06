
import { createAuth, authOrigin, type Env } from "./auth";
import { gameOrigins, internalGames } from "./games";

const websiteOrigins = [
  "https://retrac.space",
  "https://basketbros.retrac.space",
  "https://basketsmash.retrac.space",
  "https://retracdev.github.io",
  "https://soundboard.retrac.space",
];

const headers = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://space-api.retrac-space.workers.dev; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let response: Response;

    try {
      const url = new URL(request.url);
      const origin = authOrigin(env);
      const requestOrigin = request.headers.get("origin");

      const websiteSession =
        url.pathname === "/api/auth/get-session" &&
        requestOrigin !== null &&
        websiteOrigins.includes(requestOrigin);

      if (url.origin !== origin)
        return new Response("Not found", {
          status: 404,
          headers: { ...headers, "Cache-Control": "no-store" },
        });

      if (url.pathname.startsWith("/api/internal/games/")) {
        response = await internalGames(request, env);
      } else if (url.pathname === "/api/auth/token") {
        const caller = request.headers.get("origin");

        if (
          (caller &&
            caller !== origin &&
            !gameOrigins(env).includes(caller)) ||
          request.headers.get("sec-fetch-site") === "cross-site"
        ) {
          response = new Response(null, { status: 403 });
        } else if (request.method === "OPTIONS") {
          const requested = (
            request.headers.get("access-control-request-headers") ?? ""
          )
            .toLowerCase()
            .split(",")
            .map((h) => h.trim())
            .filter(Boolean);

          response = new Response(null, {
            status:
              caller &&
              gameOrigins(env).includes(caller) &&
              request.headers.get("access-control-request-method") === "GET" &&
              requested.every((h) => h === "content-type")
                ? 204
                : 403,
          });
        } else if (request.method !== "GET") {
          response = new Response(null, { status: 405 });
        } else {
          response = await createAuth(env).handler(request);
        }
      } else if (url.pathname === "/api/config") {
        response = Response.json({
          google: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
        });
      } else if (url.pathname.startsWith("/api/auth/")) {
        const disabled = [
          "/request-password-reset",
          "/reset-password",
          "/forget-password",
          "/send-verification-email",
          "/verify-email",
          "/delete-user/callback",
        ];

        if (websiteSession && request.method === "OPTIONS") {
          const requestedHeaders =
            request.headers
              .get("access-control-request-headers")
              ?.toLowerCase()
              .split(",")
              .map((header) => header.trim()) ?? [];

          response = new Response(null, {
            status:
              request.headers.get("access-control-request-method") === "GET" &&
              requestedHeaders.every(
                (header) => header === "content-type",
              )
                ? 204
                : 403,
          });
        } else if (
          disabled.some(
            (path) =>
              url.pathname === "/api/auth" + path ||
              url.pathname.startsWith("/api/auth" + path + "/"),
          )
        ) {
          response = new Response("Not found", { status: 404 });
        } else if (
          !["GET", "HEAD"].includes(request.method) &&
          request.headers.get("origin") !== origin
        ) {
          // Reject foreign and missing browser origins for mutations.
          response = Response.json(
            { message: "Request origin is not allowed." },
            { status: 403 },
          );
        } else {
          response = await createAuth(env).handler(request);
        }
      } else {
        response = await env.ASSETS.fetch(request);
      }

      // Expose only the username to approved websites.
      if (
        websiteSession &&
        request.method === "GET" &&
        response.ok
      ) {
        const session = (await response.json()) as {
          user: { username?: string };
        } | null;

        response = Response.json(
          session
            ? { user: { username: session.user.username ?? null } }
            : null,
          response,
        );
      }

      response = new Response(response.body, response);

      if (url.pathname === "/api/auth/get-session") {
        response.headers.append("Vary", "Origin");
      }

      if (
        websiteSession &&
        (request.method === "GET" ||
          (request.method === "OPTIONS" &&
            response.status === 204))
      ) {
        response.headers.set(
          "Access-Control-Allow-Origin",
          requestOrigin!,
        );
        response.headers.set(
          "Access-Control-Allow-Credentials",
          "true",
        );

        if (request.method === "OPTIONS") {
          response.headers.set(
            "Access-Control-Allow-Methods",
            "GET",
          );
          response.headers.set(
            "Access-Control-Allow-Headers",
            "Content-Type",
          );
        }
      }

      for (const [key, value] of Object.entries(headers)) {
        response.headers.set(key, value);
      }

      if (url.protocol === "https:") {
        response.headers.set(
          "Strict-Transport-Security",
          "max-age=31536000",
        );
      }

      if (url.pathname.startsWith("/api/")) {
        response.headers.set("Cache-Control", "no-store");
      }

      tokenCors(request, env, response);
      return response;
    } catch {
      // Never expose provider errors, tokens, or stack traces.
      const failed = Response.json(
        { message: "Something went wrong. Please try again." },
        {
          status: 503,
          headers: {
            ...headers,
            "Cache-Control": "no-store",
          },
        },
      );

      tokenCors(request, env, failed);
      return failed;
    }
  },
};

function tokenCors(
  request: Request,
  env: Env,
  response: Response,
) {
  if (
    new URL(request.url).pathname !== "/api/auth/token"
  ) {
    return;
  }

  response.headers.append("Vary", "Origin");

  const caller = request.headers.get("origin");

  try {
    if (
      new URL(request.url).origin !== authOrigin(env) ||
      !caller ||
      !gameOrigins(env).includes(caller)
    ) {
      return;
    }

    if (
      request.method === "OPTIONS" &&
      response.status !== 204
    ) {
      return;
    }

    response.headers.set(
      "Access-Control-Allow-Origin",
      caller,
    );
    response.headers.set(
      "Access-Control-Allow-Credentials",
      "true",
    );

    if (request.method === "OPTIONS") {
      response.headers.set(
        "Access-Control-Allow-Methods",
        "GET",
      );
      response.headers.set(
        "Access-Control-Allow-Headers",
        "Content-Type",
      );
    }
  } catch {
    // Invalid configuration must fail closed.
  }
}
