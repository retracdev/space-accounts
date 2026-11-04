import { createAuth, authOrigin, type Env } from "./auth";

const headers = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
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
      if (url.origin !== origin)
        return new Response("Not found", {
          status: 404,
          headers: { ...headers, "Cache-Control": "no-store" },
        });
      if (url.pathname === "/api/config") {
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
        if (
          disabled.some(
            (path) =>
              url.pathname === "/api/auth" + path ||
              url.pathname.startsWith("/api/auth" + path + "/"),
          )
        )
          response = new Response("Not found", { status: 404 });
        // Reject foreign and missing browser origins for mutations, including same-site siblings.
        else if (
          !["GET", "HEAD"].includes(request.method) &&
          request.headers.get("origin") !== origin
        ) {
          response = Response.json(
            { message: "Request origin is not allowed." },
            { status: 403 },
          );
        } else response = await createAuth(env).handler(request);
      } else response = await env.ASSETS.fetch(request);
      response = new Response(response.body, response);
      for (const [key, value] of Object.entries(headers))
        response.headers.set(key, value);
      if (url.protocol === "https:")
        response.headers.set("Strict-Transport-Security", "max-age=31536000");
      if (url.pathname.startsWith("/api/"))
        response.headers.set("Cache-Control", "no-store");
      return response;
    } catch {
      // Never return provider errors, request bodies, tokens, or stack traces.
      return Response.json(
        { message: "Something went wrong. Please try again." },
        { status: 503, headers: { ...headers, "Cache-Control": "no-store" } },
      );
    }
  },
};
