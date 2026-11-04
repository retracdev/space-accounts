# Deployment and operations

These are operator instructions, not authorization to deploy. No resources, live DNS changes, or paid services are provisioned by this repository. Use personal retrac.space infrastructure, separate from Retrac Labs.

## Supported domain strategy

Use [Cloudflare Pages advanced mode](https://developers.cloudflare.com/pages/functions/advanced-mode/): `_worker.js` runs Better Auth on the Workers runtime with D1, and `ASSETS` serves the Vite interface. It is not a static-only deployment.

[Pages custom subdomains](https://developers.cloudflare.com/pages/configuration/custom-domains/) support externally managed DNS. Associate `accounts.retrac.space` with Pages first, then add its CNAME in Vercel. Ordinary [Workers custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) expect a Cloudflare zone. A CNAME to workers.dev is not equivalent and cannot establish retrac.space cookies. Keep nameservers, apex records, the existing GitHub Pages site, registration, and DNS management at Vercel.

## Setup after approval

1. Install Node 24, run `npm ci`, authenticate using `npx wrangler login`, and confirm the personal Cloudflare account.
2. Create D1: `npx wrangler d1 create space-accounts`. Replace the deliberately unusable all-zero database ID in `wrangler.jsonc` with its returned ID. Keep the `DB` binding and migrations directory.
3. Create a direct-upload Pages project: `npx wrangler pages project create space-accounts --production-branch main`. Use an available name if necessary. Do not enable automatic production deployments.
4. Generate a random secret with at least 32 bytes (e.g. `openssl rand -base64 48`) and set it using `npx wrangler pages secret put BETTER_AUTH_SECRET --project-name space-accounts`. Set production `BETTER_AUTH_URL=https://accounts.retrac.space` in Pages settings. Never put secrets in source, command arguments, issues, or PRs. Verify the D1 binding in the dashboard.
5. Create a Google Web OAuth client for this personal gaming platform. Configure consent, domain verification, and Google's publishing requirements. Set origin `https://accounts.retrac.space` and redirect URI `https://accounts.retrac.space/api/auth/callback/google`. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` through Pages secrets. Local testing can use a separate client with `http://localhost:8788/api/auth/callback/google`. Never reuse Retrac Labs credentials.
6. Review SQL, back up existing data for future migrations, then run `npx wrangler d1 migrations apply space-accounts --remote`. Never reset remote databases.
7. Run `npm run check`. Publish only after approval with `npx wrangler pages deploy dist --project-name space-accounts --branch main`. The build includes `dist/_worker.js`; static drag-and-drop is insufficient.
8. Associate `accounts.retrac.space` in Pages → Custom domains. Then add **only** CNAME `accounts` → `<actual-project>.pages.dev` in Vercel DNS. Follow certificate validation records Cloudflare requests; check CAA if issuance fails. Do not change nameservers or existing site records.
9. Wait for TLS/domain activation. The Worker refuses noncanonical hosts, including pages.dev and previews. Staging needs a separate project, database, secrets, OAuth client, and reviewed origin configuration; never attach previews to production D1.
10. Complete live acceptance checks with disposable accounts before inviting users. This phase does not deploy production.

There is no mail provider setup. No verification, recovery, reset, welcome, or transactional email is implemented.

## Acceptance checks

- Check supplied branding on desktop/mobile; tab through forms, errors, and confirmation controls.
- Register with email/password and immediately sign in with username or email. Reject duplicate/reserved usernames and weak passwords.
- Complete real Google OAuth and username selection. Reload and confirm persistence; test cancellation. Real consent requires provider credentials and is outside local tests.
- Change username and email (current password required), then password; verify other sessions are revoked. Google email/password remain managed by Google.
- Delete disposable credential and Google accounts. Credential deletion requires a password; Google deletion requires a session less than ten minutes old. Check database/session removal and stale-session rejection.
- Confirm no recovery/verification UI or endpoints. Forgotten passwords cannot be recovered through this service.
- Inspect cookies: Secure, HttpOnly, SameSite=Lax, Path=/, no Domain. API responses are no-store; foreign/sibling mutation origins fail.
- Anonymous or revoked `GET /api/auth/get-session` returns HTTP 200, JSON null, without redirects: the normal guest state.
- Check the existing retrac.space site and apex DNS still work unchanged.

## Security, limits, and operations

Better Auth CSRF/origin checks remain enabled. The Worker also checks exact mutation origins. OAuth retains state validation. Account linking is disabled: unverified emails must never merge password accounts with Google identities. Password emails stay unverified by design. Email changes require the password; Google email is managed by Google. Password changes revoke other sessions. Deletion requires credential confirmation or fresh Google authentication plus UI confirmation.

There is no email recovery or support bypass. Recovery/verification routes are explicitly blocked. Do not mark password registrations verified or add mail configuration.

Rate limits use Better Auth D1 storage and Cloudflare's connecting-IP header. They reduce abuse but are not hard distributed quotas under simultaneous races. Monitor D1 writes/storage and add edge protection if needed. Never log passwords, session cookies, OAuth tokens, full bodies, or production user data. Unexpected errors return sanitized responses.

Pages Functions use Workers quotas. Password hashing is intentionally expensive: measure CPU/memory under the actual free plan before release. Do not weaken hashing to fit quotas. Get approval before paid upgrades. Review [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) at deployment time.

Rollback uses a tested Pages deployment with compatible D1 schema. Avoid destructive down migrations. Keep backups private; rotate leaked secrets and revoke affected sessions. Review retention of expired sessions, verification rows (OAuth state), and rate-limit keys as usage grows.

## Dependency audit

The test runner is pinned to a release beyond the reported critical worker-pool advisories. Miniflare's transitive Undici and Sharp dependencies are pinned through overrides to patched releases; local Worker/D1 tests validate the resulting installation.

The remaining moderate development-tool reports come from [Minimatch glob amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249) in ESLint's dependency tree and the [older esbuild development server](https://github.com/advisories/GHSA-67mh-4wv8-2f99) in Drizzle Kit's TypeScript loader. These packages are not bundled into the deployed auth Worker. Lint only trusted checkout files; this project does not start esbuild's development server. Track upstream compatible fixes rather than forcing an incompatible major Minimatch release into ESLint or accepting audit's suggested obsolete tool downgrades. The audit is not claimed to be completely clean.
