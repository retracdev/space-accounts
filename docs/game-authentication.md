# Game authentication bridge

Contract reviewed against `retracdev/space-api` main: `docs/accounts-integration.md`,
`src/accounts.ts`, `src/worker.ts`, and deployment configuration. Accounts remains
the only owner of credentials and sessions. Basic games and public projects remain
anonymous; request a token only when a player chooses an account feature.

## Configuration (operator action; no deployment performed)

Set these Cloudflare **Pages secrets** on space-accounts, separately for each environment:

- `BETTER_AUTH_SECRET`: existing account secret, at least 32 characters. Preserve it;
  it signs existing cookies and encrypts OAuth tokens and JWT private keys in D1.
- `GAME_JWT_PRIVATE_KEY`: private ES256 JWK JSON (`kty: EC`, `crv: P-256`, `x`, `y`,
  `d`). Generate locally with a cryptographic key generator, such as jose's
  `generateKeyPair('ES256', { extractable: true })` and `exportJWK(privateKey)`;
  deliver through private secret input, never git, command arguments or logs.
  Better Auth's supported adapter provisions this key into its `jwks` table on first
  token/JWKS use, encrypted with `BETTER_AUTH_SECRET`. No plaintext private key is stored
  in D1 or exposed by JWKS. Keep the source secret available for key provisioning.
- `ACCOUNTS_API_KEY`: independent random value with at least 32 bytes of entropy;
  must differ from `BETTER_AUTH_SECRET`. Use the identical secret in space-api.
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: existing optional Google configuration.

For example, use `wrangler pages secret put <NAME> --project-name space-accounts`
with private input. Do not change existing production secrets as part of this PR.

Account environment variables/bindings:

- `BETTER_AUTH_URL=https://accounts.retrac.space` (local account UI: `http://localhost:8788`).
- `GAME_AUTH_ORIGINS`: optional comma-separated, reviewed exact HTTPS game origins
  under `retrac.space`, without paths, wildcards or trailing slashes. Empty by default.
  Candidate origins in space-api main are `https://chess.retrac.space`,
  `https://pong.retrac.space`, `https://2048.retrac.space`. Enable only after verifying
  ownership and security. This grants only credentialed GET `/api/auth/token` CORS,
  not account mutations or general session reads. The token GET is checked explicitly
  by the Worker; Better Auth's mutation trustedOrigins remain account-only.
- Existing `DB` D1 and `ASSETS` Pages bindings remain unchanged.

Space-api needs Cloudflare secret `ACCOUNTS_API_KEY` with that same bridge key;
`ALLOWED_ORIGINS` lists its approved game browser origins. Keep its dedicated `DB`,
`REQUEST_LIMITER` and `WRITE_LIMITER` bindings. Do not give it account D1 access,
`BETTER_AUTH_SECRET`, Google credentials or JWT private keys. No JWT issuer/audience
environment variables are needed: issuer is `https://accounts.retrac.space` and
audience is `https://api.retrac.space`, even if API transport uses workers.dev.

Before an approved deployment, build and apply `0001_game_jwks.sql` using the existing
D1 migration process. This additive schema matches Better Auth 1.7.16's JWT fields;
no existing user, credential or session data is migrated. Account UI and greeting
checks work without bridge secrets; token provisioning fails closed until configured.

## Browser and server contract

Use the official Better Auth client and `jwtClient()` with the accounts base URL.
Credentialed GET `/api/auth/token` returns `{ "token": "..." }` only for a valid
Better Auth session; no user IDs or claims can be supplied by the caller. Tokens
contain only `sub`, `sid`, `iss`, `aud`, `iat`, `exp`, signed with ES256 for five
minutes. Keep tokens in memory and send `Authorization: Bearer <token>` to space-api
with credentials omitted. Never copy the account cookie to a game or the API.
Anonymous token requests return 401; normal anonymous get-session behavior remains
200/null. No automatic JWT response header is added to get-session, including the
existing restricted `https://retrac.space` greeting.

For approved website origins, a signed-in get-session returns only:

```json
{
  "user": { "username": "retrac" },
  "actionRequired": { "required": true, "reason": "account_review", "url": "https://accounts.retrac.space" }
}
```

`actionRequired` mirrors the operator-only `user` columns `action_required`,
`action_required_reason`, and `action_required_url`. When no action is required it is
`{ "required": false, "reason": null, "url": null }`; when one is required and no URL
is stored, `url` falls back to the account origin. Clients cannot set these fields.
Flag an account with, for example:

```sql
UPDATE user SET action_required = 1, action_required_reason = 'account_review' WHERE username = 'retrac';
```

### Moving an account off Google sign-in (`auth_unlink_google`)

Flag an account to require it to set a password and drop its Google link:

```sql
UPDATE user SET action_required = 1, action_required_reason = 'auth_unlink_google',
  action_required_url = 'https://accounts.retrac.space/unlink-google-required-setpw'
WHERE username = 'retrac';
```

Apps send the visitor to `/unlink-google-required-setpw`. There the user sets a
password; the server then deletes the Google account link and clears the flag, and the
page shows their username, email, and password.

**Deliberate trade-off:** sign-in and sign-up now start with an email/username step.
If that identifier belongs to a flagged account, the user is signed in **without a
password** so a locked-out owner can set one. This applies only while the flag is set;
it is cleared as soon as a password is saved. Flag only accounts that need it.

Both internal routes require POST, JSON, **no Origin header**, and
`X-Space-Api-Key`. They return no cookies or CORS headers and are no-store:

| Route | Input | Response |
| --- | --- | --- |
| `/api/internal/games/session` | `{}` plus bearer token | `{ "id": "stable user ID", "username": "current_name" }` (username may be null) |
| `/api/internal/games/players` | `{ "ids": ["id1"] }` or `{ "username": "current_name" }` | Array of current `{ id, username }` |

The bridge checks ES256 signature against the account plugin's own local JWKS,
issuer, audience, mandatory claims, expiry and maximum 300-second lifetime. Every
session call then joins the existing session and user tables by `sid` and `sub`,
requiring an unexpired live session. Sign-out, password/session revocation and
deletion invalidate existing JWTs immediately; username changes appear immediately.
Null usernames represent incomplete onboarding; space-api returns 403 for protected
features until a username exists. Directory reads omit deleted users, return [] for
unknown users, and return only ID and normalized username, never email or credentials.

Invalid/revoked tokens return 401; bad service credentials/browser origins return
403; unavailable configuration/storage returns sanitized 503. Requests are capped
at 32 KiB; directory batches at 100 IDs of at most 256 characters. An atomic counter
in the existing rate-limit table caps authenticated internal calls at 600/minute per
Cloudflare source IP. This is a finite service guard, not a substitute for API player
rate limiting. Do not log tokens, service keys, bodies or private account data.

JWKS is public at GET `/api/auth/jwks`; it contains public keys only. No automatic
key rotation is configured. For planned rotation, privately update the signing-key
secret and expire the current JWKS row through a reviewed operational change;
Better Auth provisions the replacement and retains the old public key for its grace
period. Changing the secret alone does not replace an existing live D1 signing key.
For compromise, remove the compromised JWKS row so verification immediately rejects
it, and replace the secret before provisioning a new key. Revoking sessions also
immediately blocks their tokens. Back up data and coordinate any auth-secret rotation
with Better Auth's encryption/session procedures. Never disable encryption.

The previous `future-games.md` server-auth proposal is superseded by this bridge.
The greeting's exact-origin, GET-only policy, cookie attributes, CSRF checks,
account-management origin guard and login flows are unchanged.
