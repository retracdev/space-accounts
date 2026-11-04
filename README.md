# space-accounts

The personal account system for **retrac.space**, separate from Retrac Labs. TypeScript, Better Auth, Drizzle, and Cloudflare D1 run in a Cloudflare Pages advanced-mode Worker. The responsive account site uses the supplied branding and Space Grotesk from Google Fonts.

## First phase

- Email/password registration; username or email password sign-in; Google OAuth.
- Unique, case-insensitive usernames (3–20 letters, numbers, underscores; reserved names excluded). Google users finish username selection before account onboarding is complete.
- Account settings, username changes, password-confirmed email changes, password changes that revoke other sessions, sign-out, and confirmed deletion.
- D1-backed sessions and rate limiting; exact origin checks and Better Auth CSRF protections; host-only secure production cookies.
- **No outgoing email, verification, password reset, or recovery.** A forgotten password cannot be recovered through this service. Google credentials and email remain managed by Google. Automatic account linking is disabled.

Basic games remain available to guests. Session checks return HTTP 200 with JSON null when signed out; they do not redirect to sign-in. Games can offer contextual sign-in for cloud saves, persistent leaderboards, achievements, or multiplayer. No games, multiplayer, or space-api are implemented here.

## Local development

Use Node **24** and npm. No Cloudflare login or production credentials are needed for local D1 and automated tests.

```sh
npm ci
cp .env.example .dev.vars
# Replace BETTER_AUTH_SECRET with a random local value of at least 32 characters.
npm run db:migrate
npm run dev
```

On PowerShell, use `Copy-Item .env.example .dev.vars`. Open **http://localhost:8788** (not 127.0.0.1, which is intentionally outside the trusted origin). The dev command builds and runs the complete Worker with local persistent D1. After editing source, stop and rerun it to rebuild. Do not open Vite directly: authentication requires the Worker.

Google is shown only when both OAuth variables exist in `.dev.vars`. Configure a separate local Google client with callback `http://localhost:8788/api/auth/callback/google`. Password registration works without Google or any external service. Never put real secrets in `.env.example`; `.dev.vars`, env files, local databases, and build output are ignored.

```sh
npm run check          # lint, TypeScript, automated tests, production build
npm run db:generate    # create migration after deliberate schema changes
npm run db:migrate     # apply committed SQL to local D1 only
```

Tests exercise the bundled Worker in Miniflare with real emulated D1 and committed migrations. They cover username policy and collisions, immediate unverified login, username/email sign-in, session cookie security, origin rejection, rate limits, settings, revocation, deletion, disabled recovery, and anonymous guest state. Real Google consent and production TLS/domain behavior require the documented acceptance checks; they are not claimed by local tests.

## Structure

| Path | Responsibility |
| --- | --- |
| `src/server/auth.ts` | Better Auth configuration and sensitive-action hooks |
| `src/server/worker.ts` | Canonical host, security headers, API routing, static assets |
| `src/server/schema.ts`, `migrations/` | Drizzle schema and versioned D1 migrations |
| `src/client/` | Consumer account interface |
| `src/shared/username.ts` | Shared username policy |
| `public/` | Supplied original logo and favicons |
| `tests/` | Policy and Worker/D1 integration tests |

## Deployment and future games

[Deployment instructions](docs/deployment.md) explain exact Cloudflare, Google, and Vercel DNS steps. Pages supports the account subdomain with DNS remaining at Vercel; no nameserver changes or GitHub Pages changes are needed. The committed database ID is a nonproduction placeholder. No deployment runs in CI.

[Future game integration](docs/future-games.md) describes optional authentication, normal guest state, protected feature authorization, host-only cookies, and explicit origin trust. No custom authentication protocol or SDK is introduced. Game origins are deliberately not trusted until their integration is reviewed.

## License

The repository already contained an [MIT license](LICENSE) before this implementation; it is retained unchanged. No additional license grant is introduced. The repository is not accepting public contributions; only authorized collaborators may change the original project.
