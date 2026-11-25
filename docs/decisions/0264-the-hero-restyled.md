# 0264. The hero, restyled

- Status: accepted
- Date: 2026-11-17
- Topic: The site

## Context

The owner's ruling 6 of 17 November 2026: the hero is the live hero, restyled to Plex and aligned to the page column.

## Decision

1. **Unchanged:** the film and its phone cut, the poster, the three overlays (at their live alphas, now the
   `film-scrim` role), the turning line with `aria-live`, Pause and Play (WCAG 2.2.2), and every refusal to play by
   itself: reduced motion, Save-Data, a connection below 4G.
2. **Restyled:** Plex throughout; the turning line 40 to 80 px at 600 with -0.02em tracking; the title 20 to 26 px at 500. The copy sits bottom left on the page column; "{serviceArea} · home service" sits top left and Pause top right,
   both on the column.
3. **Calls to action:** "Book a free consultation" is the one filled button, gold, and comes first; "Try a new look" is
   the outline on navy beside it on a laptop and under it on a phone, both full width there.

## Consequences

- One new string, `hero.area`, built from `serviceArea`; since 25 November 2026 it names the one city served, Gurgaon
  (the owner's ruling), while the footer and the questions keep the service area.
- The hero's browser tests keep every motion and refusal case; a new one plays the film and pauses it with Pause.
