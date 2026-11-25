# 0318. Care team beside Messages

- Status: accepted
- Date: 2026-11-25
- Topic: The ops console
- Amends [0208](0208-the-console-redesigned.md) on where Care's team is drawn; restores the placement of
  [0134](0134-care-cover.md) and [0139](0139-care-shifts.md)

## Context

ADR 0208 put everything the console is set up with in Settings, Care's team among it, taking it from beside the inbox.
But three of the Care team's actions are work, not setup: a member going on and off shift, their first act of the day
(0139 put the switch on the Messages page so); a member's leave; and moving every client of one member to another, as
when one leaves. In Settings alone, a Care member opened Settings to start the day. The owner asked on 24 November 2026
that no task or action be hidden in Settings.

## Decision

1. **Messages is an entry of two pages, Messages and Care team** (`/care-team`), as Inventory's pages are one entry. At
   a desk the navigation lists them beneath Messages; on a phone, or with the navigation folded, they are tabs.
2. **Care team draws the same rota Settings draws**: the signed-in member's shift switch, the team, and each member's
   record with days off, leave and Move every client, each action for whoever may call it, as in Settings.
3. **Settings › Care › Team stays**, beside Care's rules, so nothing moves away from anyone who uses it there.
4. **The trail above Messages names it once.** A page that bears its entry's own name has no entry crumb above it.

## Consequences

- One who may read the Care team and nothing else lands on it.
- Tests: `e2e/ops/messages.e2e.ts`, `test/node/apps/ops/dom/ops-route.test.ts`.
