# 0286. The browser's and the home screen's icons are the mark

- Status: accepted, on the owner's ruling of 19 November 2026
- Date: 2026-11-19
- Topic: Platform
- Amends [0023](0023-launch-hardening.md) and [0043](0043-client-app.md) on the drawing the icons carry

## Context

The brand kit (`design/brand/README.md`) drew two favicon cuts apart from the mark: the crown alone for 32 px, and its
outline for 16, since the mark's fan strands close up below 34 px. Every icon was drawn from them: the site's tab icons
and favicon.ico, the touch icon, both apps' tab and home-screen icons up to 512 px, and the console's tab. A tab, a
bookmark and a home screen showed a crown that is not the logo, even at 180 and 512 px, where the mark itself is clear;
and the crown cut kept, at its foot, a scrap of the waves it was cut from.

The owner asked, 19 November, that the icons be the logo.

## Decision

1. **Every icon is the mark, gilt on ink as before**, at the sizes it was: the site's favicons at 16, 32 and 48 px and
   its favicon.ico, the touch icon, and the apps' 192, 512 and maskable icons, touch icons and favicons. The console's
   tab links the gilt mark's SVG.
2. **The two favicon cuts leave the kit**, which keeps its eleven drawings.

## Consequences

- At 16 px, where a screen draws the tab at its own size, the waves and the crown run together, as the kit warned; the
  32 px icon, which a high-density screen draws in the tab, reads as the mark.
- The maskable icon's mark, taller than wide, still sits inside the circle a launcher may crop to.
- Tests: `e2e/launch.e2e.ts`, `test/node/apps/app/app-pwa.test.ts`.
