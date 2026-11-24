# Guided setup: sign in and come back

`https://accounts.retrac.space/guided-setup` is a focused sign-in page for games and
apps. Instead of dropping players on the account site and hoping they find their way
back, link here. The player chooses **Sign in** or **Create an account**, finishes,
sees an animated "All set" check mark, and is sent straight back to your page.

No database or server changes are needed to adopt it. It uses the normal account
session, so after the redirect your page reads the session the same way it already
does (`get-session` for websites, `/api/auth/token` for games; see
[game-authentication.md](game-authentication.md)).

## Parameters

| Parameter  | Required    | Meaning |
| ---------- | ----------- | ------- |
| `redirect` | Yes         | Full URL to return to once signed in. Must be `https://retrac.space` or an `https://*.retrac.space` subdomain (no custom port), or `http://localhost` / `http://127.0.0.1` (any port) for local development. Anything else is ignored. |
| `app`      | Recommended | Game or app name shown as "Continue to **Chess**". Plain text, up to 48 characters. Defaults to the redirect's hostname. |
| `image`    | Optional    | Artwork shown on the right. Must be `https://` on `retrac.space` or a subdomain. Missing, disallowed, or broken images fall back to a random gradient. |

Build the link with `URLSearchParams` so values are encoded correctly:

```js
const setup = new URL("https://accounts.retrac.space/guided-setup");
setup.searchParams.set("app", "Chess");
setup.searchParams.set("redirect", location.href); // come back to this exact page
setup.searchParams.set("image", "https://chess.retrac.space/account-art.webp");
location.assign(setup); // same tab, so there is no extra tab to remember
```

If `redirect` is missing or not allowed, sign-in still works, but the final screen
tells the player to close the tab instead of redirecting, and the page logs a
`guided-setup:` warning to the console.

## Image specification

- **Size:** 960 × 1200 px (4:5 portrait). Larger is fine if it is the same ratio.
- **Format:** WebP or JPEG (PNG for flat art), ideally under 300 KB.
- **Cropping:** the image is scaled to fill and cropped from the center. On phones
  it becomes a 16:9 banner above the form, so keep the subject and any text inside
  the **middle 960 × 540 px band** (vertically centered).
- **Content:** no text that imitates buttons or form fields; the page has a dark
  theme (`#07060d` background), so art with a dark or saturated palette fits best.
- **Hosting:** serve it from your game's own `*.retrac.space` origin. Other hosts are
  blocked by the account site's Content-Security-Policy.

## What the player sees

1. **Choice:** "Continue to *App*", with **Sign in** and **Create an account**. If
   they are already signed in, it instead offers **Continue as *username*** or
   **Use a different account**.
2. **Details:** the normal two-step account flow (email or username, then password),
   plus Continue with Google when enabled. Google returns to the guided page.
3. **Username:** new Google accounts choose a username before leaving.
4. **All set:** an animated check mark, then `location.replace(redirect)` after about
   1.6 seconds (0.6 seconds with reduced motion). A "Continue" link is shown in case
   the redirect is blocked.

Accounts flagged with a required action (see game-authentication.md) are sent to
that action's page as usual, which takes precedence over the return trip.

## On your page after the return

Nothing in the URL says the sign-in succeeded, so don't trust a query flag. Re-check
the session when the page loads, as you already do, and continue if it is present.
