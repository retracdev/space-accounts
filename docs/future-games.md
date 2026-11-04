# One identity for future games

Accounts owns identity, credentials, provider tokens, and sessions. Game databases and a future `space-api` own their own domain data, keyed by the immutable Better Auth `user.id`. A username can change; it is not a primary key. No game or shared API is implemented here.

The first integration keeps the **host-only** cookie on `accounts.retrac.space`. Only when a player chooses an account-only feature may a game offer a nonintrusive link to `https://accounts.retrac.space/sign-in`; afterward they navigate back. Never redirect on game entry. There is no arbitrary return-URL relay. New Google identities choose a username on the account site; a nullable username represents incomplete onboarding.

When a game is implemented, use the official [Better Auth client](https://better-auth.com/docs/integrations/vanilla-js) with `baseURL: 'https://accounts.retrac.space'` and credentialed fetch requests. The game browser asks `/api/auth/get-session` for identity. Cookie sharing through `Domain=.retrac.space` is unnecessary: the browser sends the account cookie to the account origin. These are same-site, cross-origin requests on HTTPS.

**This phase deliberately enables no game origins.** As each game ships, review the origin and add its exact HTTPS origin to Better Auth `trustedOrigins`, the Worker's explicit mutation-origin allowlist, and a narrowly scoped CORS implementation. Return `Access-Control-Allow-Origin` only for approved origins, `Access-Control-Allow-Credentials: true`, `Vary: Origin`, and appropriate preflight responses. Never use `*.retrac.space`, reflect arbitrary Origin, disable CSRF checks, or add localhost to production trust. Test denied sibling origins again. Any sibling granted auth API access is trusted code and must be secured accordingly.

For game **server** authorization, forward the incoming account cookie only to the canonical Better Auth session endpoint, or use a private Cloudflare service binding to the same auth handler. Do not treat a browser-supplied user ID, username, cached client session, or profile object as authorization. For protected features, require a live non-expired session and a non-null valid username before serving authenticated game actions. The account service owns session validation; do not copy the auth secret, D1 access, OAuth tokens, or password hashes into game services. Do not cache session responses across users. Host-only cookies are not sent to a game's server: server-side game authentication will need a separately reviewed official Better Auth integration (for example its supported OAuth provider flow), rather than copying cookies or inventing an exchange protocol.

If direct server-side shared-cookie access becomes necessary later, Better Auth supports [cross-subdomain cookies](https://better-auth.com/docs/concepts/cookies). That expands trust to every sibling, including GitHub Pages and future games; review ownership and takeover risks first. A workers.dev response cannot set a retrac.space cookie.

## Guests are first-class players

Authentication is optional for basic functionality. Games start normally and use local browser storage for guest single-player progress. Never redirect a visitor just because they opened a game.

The standard `GET /api/auth/get-session` returns HTTP 200 with JSON `null` for missing or invalid sessions, without redirecting. Interpret this as a normal guest state. Network failures are distinct: local play should still work, but never claim a cloud save succeeded during an outage.

Each game chooses which features require an account, such as cloud saves, persistent leaderboards, synced achievements, and online multiplayer. When guests request one, offer sign-in in context without blocking local play. Future local-to-cloud progress migration needs an explicit conflict policy; none is implemented here.

Protected endpoints must independently validate sessions and resource ownership: 401 for missing/invalid authentication and 403 for insufficient authorization. Optional-auth requests return a normal guest result. Browser UI state is never authorization.

Password accounts deliberately have unverified email; `emailVerified` must not gate usable accounts. Google can supply its verified-email claim, but account linking by email stays disabled. No games or game API are implemented here.
