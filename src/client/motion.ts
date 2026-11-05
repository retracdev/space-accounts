// The URL can enable reduced motion for testing, but never disable the OS setting.
const forced =
  new URLSearchParams(location.search).get("reduce_motion") === "true";
const preference = matchMedia("(prefers-reduced-motion: reduce)");
if (forced) document.documentElement.setAttribute("data-reduce-motion", "true");

export const motion = {
  get matches() {
    return forced || preference.matches;
  },
  onChange(listener: () => void) {
    preference.addEventListener("change", listener);
  },
};
