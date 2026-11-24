// Parameters for /guided-setup, the sign-in page games and apps send players to.
// Everything here comes from an untrusted link, so it is validated strictly:
// the return URL and image must live on retrac.space, which keeps this page
// from becoming an open redirect or showing arbitrary third-party images.

export const GUIDED_SETUP_PATH = "/guided-setup";

/** Recommended artwork size (4:5 portrait). It is cropped to fill, centered. */
export const GUIDED_IMAGE = { width: 960, height: 1200 } as const;

export const APP_NAME_MAX = 48;
const URL_MAX = 2048;
const FALLBACK_NAME = "retrac.space";

const retracHost = (host: string) =>
  host === "retrac.space" || host.endsWith(".retrac.space");

function parse(value: string | null): URL | null {
  if (!value || value.length > URL_MAX) return null;
  try {
    const url = new URL(value);
    return url.username || url.password ? null : url;
  } catch {
    return null;
  }
}

/** Where to send the player once they are signed in, or null when unsafe. */
export function guidedReturnUrl(value: string | null): URL | null {
  const url = parse(value);
  if (!url) return null;
  if (url.protocol === "https:" && url.port === "" && retracHost(url.hostname))
    return url;
  // Local development of a game: http://localhost:5173/...
  if (
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1")
  )
    return url;
  return null;
}

/** Artwork for the right-hand side, or null to use a generated gradient. */
export function guidedImageUrl(value: string | null): URL | null {
  const url = parse(value);
  return url &&
    url.protocol === "https:" &&
    url.port === "" &&
    retracHost(url.hostname)
    ? url
    : null;
}

/** A short, plain-text display name for the game or app. */
export function guidedAppName(value: string | null, returnUrl: URL | null) {
  const name = (value ?? "")
    // Collapse whitespace, then drop control and bidi-override characters.
    .replace(/\s+/g, " ")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .trim();
  if (name) {
    const chars = [...name];
    return chars.length > APP_NAME_MAX
      ? chars.slice(0, APP_NAME_MAX - 1).join("").trimEnd() + "…"
      : name;
  }
  return returnUrl?.hostname ?? FALLBACK_NAME;
}

export interface GuidedSetup {
  app: string;
  returnUrl: URL | null;
  image: URL | null;
  /** Set when coming back from Google sign-in: finish right away. */
  done: boolean;
}

export function guidedSetup(search: string): GuidedSetup {
  const params = new URLSearchParams(search);
  const returnUrl = guidedReturnUrl(params.get("redirect"));
  return {
    app: guidedAppName(params.get("app"), returnUrl),
    returnUrl,
    image: guidedImageUrl(params.get("image")),
    done: params.get("step") === "done",
  };
}
