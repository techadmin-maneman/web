# 0233. Settings, to the November redesign

- Status: accepted
- Date: 2026-11-02
- Topic: The ops console
- Amends [0225](0225-the-console-on-a-desk-and-a-phone.md) with the redesign's eighth step

## Context

The last of the redesign's eight steps (ADR 0225): Settings. The design sets each page's rules in panels, a rule of several figures in a panel of its own, its figures two to a row with each name above its box, the whole page edited at once and saved with one Save bar. Since 18 October every setting is changed where it reads, one at a time, and someone who may only view sees the values themselves (ADR 0212). Asked on 2 November 2026 which Settings should follow, the owner chose to keep editing in place and take the design's layout.

## Decision

1. **Every figure stands two to a row** at a desk (`SettingPairs`), its name above its value (`EditableRow`'s `stacked`); one beneath another short of a desk. A rule of several figures stands in a panel of its own, under its name; the rules of one figure stay together in their subject's panel.
2. **Each value is still changed where it reads and saved on its own** (ADR 0212): no Save bar, and no box shows to someone who may only view.

## Where the build departs from the files, and why

- **No open boxes and no Save bar:** the owner's ruling of 2 November 2026, which keeps ADR 0212.
- **The menu folds every group but the open page's,** where the design opens all of them: thirty pages in nine groups run past a laptop's height, as the design's own menu runs past its frame; a search unfolds them all.
- **No line beneath the title saying who changed the page last:** each rule set by hand says so on its own, with the way back to its standard figures.

## Consequences

- `e2e/ops/one-box-a-line.ts` holds as it was: a box opens one at a time, where it reads.
