# 0313. The Settings screens, to the 22 November redesign

- Status: accepted
- Date: 2026-11-24
- Topic: The ops console
- Amends [0212](0212-editing-in-place.md) for a page of Settings

## Context

The redesign's seventh piece is Settings (docs/prompts/ops-redesign.md, step 6). The console already had every page
and group the prototype draws, and the same rules on them. What differed was how Settings is reached and how a
setting is changed, and what a few tables count. The owner ruled on 24 November:

- each setting changes from its own Change, in a small dialog, as the design draws it, in place of the value as its own
  button (ADR 0212);
- the tables count each city's, package's and pincode's active clients;
- a city's tier, which the data has no notion of, is left out.

## Decision

1. **Settings is reached as the design draws it.**
   - Its groups stand beneath it in the navigation, each opening on its first page the person may open; on a phone,
     where the navigation is not drawn, they are a row of tabs.
   - The open group's pages are a tab each, with Find a setting at the bar's right.
   - What a search finds, pages by name and rules by title or note, stands in a panel above the page, with Clear.
   - The page's own menu column goes.
2. **A setting changes from its own Change.**
   - On every page of Settings a row reads its name, its value and Change.
   - Change opens the box, or boxes, in a small dialog titled by the setting, which says the value now, with Cancel
     and Save.
   - A rule's figures stand one to a line.
   - A row inside a drawer, a record's, still changes in place (ADR 0212), so no dialog opens over a drawer.
3. **Cities, Packages and Areas count active clients**: those whose stage is active (docs/decisions/0307), never one
   erased or a test record, a city's by its pincodes, in a column of their own.
4. **What a page says waits, it says as the design does**:
   - Cities names those that take bookings with no technician;
   - Packages says beside its title that its prices include GST, and names those not yet sold for want of a priced
     hair system;
   - Words puts "Publish N changes" on its button, says above the table how many changes wait, and has a Review
     column;
   - Day times titles the times in force by the day they began.

## Consequences

- Targets shows each target with no progress against it: the design's "612 so far" asks for each measure's figure for
  the month, which the targets read does not hold.
- Settings' search reads every rule the first time something is typed, as the menu's did.
- Tests: `e2e/ops/settings.e2e.ts`, `e2e/ops/console.e2e.ts`, `test/worker/ops/active-clients.test.ts`.
