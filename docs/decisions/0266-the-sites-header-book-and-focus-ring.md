# 0266. The site's header Book and focus ring

- Status: accepted
- Date: 2026-11-17
- Topic: The site
- Amends [0262](0262-the-sites-typeface-and-palette.md): decisions 3 and 4
- Amends [0263](0263-the-home-pages-order-and-bands.md): decision 6

## Context

ADR 0262 left two questions to the owner: the boards draw the header's Book filled beside every section's own filled
button, where the brief allows one filled button to a view; and brass, the brief's focus ring, is under WCAG 1.4.11's 3:1
on white (3.0:1) and on the cool ground (2.8:1), so PR 1 drew gold-700 there. The owner ruled on both on 17 November 2026.

## Decision

1. **The header's Book is an outline**, on a phone and a laptop alike, so a screen's one filled button is the page's own:
   a section's, or on a phone the sticky bar's.
2. **The focus ring is brass on every ground**, as the brief gives it: 5.1:1 on navy, and under 3:1 on white and cool,
   which the owner accepted.

## Consequences

- The header draws no filled button anywhere on the site; the flow's bar on a laptop's `/try` keeps its free
  consultation as an outline too.
- `--site-focus` is brass, and gold-700 leaves the site's roles.
