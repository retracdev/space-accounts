# Branding

The site uses the supplied `retrac.space logo.png` byte-for-byte in `public/brand/logo.png`. Original workspace account artwork remains in `assets/`.

The wide logo includes transparent canvas padding. The header uses a viewport around that padding without stretching or redrawing the wordmark.

## Accounts icon

The favicon and the header's "Your account" mark share one icon: a frosted-glass person on a rounded yellow tile, in the iOS 26 "liquid glass" style. The tile gradient (#FFF3CC → #FAE7A5 → #EFC45E) follows the yellow of the retrac.space favicon.

- `public/favicon.svg` and `public/brand/account.svg` are the source (64×64 viewBox, identical files).
- `public/favicon.png` (256px) and `public/favicon.ico` (16, 32, 48px) are rendered from that SVG at each size, for browsers that don't use SVG favicons. Re-render them whenever the SVG changes.

Colors follow the existing site's CSS: background #07060d and foreground #f3f0ff, with restrained lavender accents and thin borders. Secondary copy is brighter than the existing site's muted color for readability. Space Grotesk loads from Google Fonts at 400, 600, and 700, with system sans-serif only as a loading fallback.
