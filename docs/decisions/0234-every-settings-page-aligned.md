# 0234. Every Settings page in the redesign's look

- Status: accepted
- Date: 2026-11-02
- Topic: The ops console
- Amends [0233](0233-settings-redesigned.md): Settings' menu no longer folds at a desk

## Context

Step 8 (ADR 0233) set the Settings pages built from rules in the design's layout and left the other sixteen as they were: Cities, Areas, Targets, Day times, Closed days, Job sheet, Packages, Services and fees, Discount codes, Partners, Words, Care team, Remedies, Quick replies, Staff and Pay grades. Seen at full size, they differed from the rules pages and from each other: a page's main action in its head on one page and inside a panel on the next; several subjects in one panel; values beside their names, not above them; a page's figures as a bare line; empty lists said in two looks at two insets, and a list with nobody on it as a bare table head. The design draws one Settings page; on 2 November 2026 the owner asked for everything in Settings to be redesigned in line with the rest.

## Decision

1. **The menu at a desk shows every group's pages under its name in small capitals,** as the console's own navigation and the design do (`SubNav` `flat`). Short of a desk it still runs across the top and folds, as thirty pages would wrap into a wall.
2. **Every value stands two to a row, its name above it,** inside `SettingPairs`, which now tells the rows within it to stand so (`StackedRows`) and draws the lines between them: Targets, Services and fees, Day times, besides the rules pages.
3. **One subject a panel:** Areas' upload, reach, launches, a city opened and a pincode added (`AreaSection`); Targets' city and the month's every target; Day times' windows and its changes; the job sheet's checklist and each list of reasons.
4. **A page's own action is in its head:** Add a package, Create codes, Publish the site, as Add a city and the rest already were. An action of one panel stays in that panel's head.
5. **A page's pickers stand in a toolbar above its panels:** Targets' month and city, the job sheet's kind of visit.
6. **Figures are the console's tiles:** Discount codes' five, as Money's and a technician's; on a phone an odd last tile runs across both columns, so none stands alone.
7. **Nothing to list is one look,** `EmptyState`'s line, wherever a Settings or Money panel has none; Staff says so when nobody is added.

## Consequences

- `e2e/ops/settings.e2e.ts` holds the menu open at a desk; the menu still folds below 1280 px.
- Words added: "Nobody added yet." (`settings.staff.none`), in `design/ops-redesign/COPY-TODO.md`.
