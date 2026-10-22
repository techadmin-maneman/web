# 0215. The range as a table

- Status: accepted
- Date: 2026-10-19
- Topic: The site
- Amends [0103](0103-the-home-pages-first-copy-round.md)

## Context

On 19 October 2026 the owner sent the product guide of 6 October 2026, which renames NatMax as Celebrity and swaps two
bases: Natural is now the multi-layer silk top over lace, and Celebrity the thin skin with a lace front. They asked for
the range as a table comparing the four, with no price, then for each one's life in months.

The site promised no life in months for a base we fit, since the guide marks every life figure a maker's claim the
first fittings are to settle.

## Decision

1. **The range is one table**: the four across the top (Essential, Active, Natural, Celebrity) and a row each for what
   it is made for, the base, the hairline, how it breathes, how long it lasts and how often it is serviced, in the
   guide's words, on the comparison's shared table (`site/src/components/CompareTable.astro`).
2. **How long each lasts is the guide's figure**: 8, 6, 6 and 4 months, on the owner's word. Nowhere else on the site
   gives a life in months.
3. **No price**, as before (ADR 0204).
   Natural breathes "Moderate", on the owner's word of 22 October 2026, where the guide says "Lowest".
4. The materials guide says Indian remy hair on Celebrity, as the guide does.

## Consequences

- Celebrity's service visit is twice a month in the table. Its package's service cadence in the console is ops' to set
  to match.
- Tests: `test/node/site/site-content.test.ts`, `e2e/home.e2e.ts`.
