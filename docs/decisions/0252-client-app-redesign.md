# 0252. The client app redrawn: four tabs, the profile, and the client's look

- Status: accepted
- Date: 2026-11-12
- Topic: Booking and visits

## Context

The owner's brief of 12 November 2026 (`docs/prompts/client-redesign.md`) redraws the client app (`apps/app`) to the
approved prototype, revision 5 (`design/client-redesign/Client App.prototype.html`). The plan
(`docs/client-redesign/PLAN.md`) maps every current screen and state to its new place; the sync audit
(`docs/client-redesign/SYNC-AUDIT.md`) holds the owner's rulings. The owner asked for the fewest PRs: the redesign is one
PR, and production's move to Razorpay alone is a second (ADR 0257).

## Decision

1. **The look.** `apps/app/src/styles/look.css` sets the shared `--ui-*` roles from the brief's tokens, as
   `apps/tech/src/styles/look.css` does for the technician app. White ground, navy for titles, primary buttons, section
   rules and the next-visit card, gold for the one most important thing on a screen and nothing else. IBM Plex Sans
   400/500/600 from `packages/brand/fonts-plex.css`; Instrument Sans and EB Garamond leave the app. The logo is the brand
   kit's drawing (`packages/ui/Mark.tsx`). The whole app takes the look at once.
2. **Corners stay square** (owner, ruling 10): `--ui-radius-button` and `--ui-radius-box` stay 0. Circles only for radio
   dots, spinners and the before and after slider's knob.
3. **Four tabs: Home, Visits, Photos, Rewards.** Payments and invoices, address, account, privacy, sessions and deletion
   move under the profile, opened from the client's initials at the top right. The bell beside them opens the alerts
   inbox (ADR 0255). Every old path redirects to its new place, so links in messages already sent still open:
   `/payments` → `/profile/payments`, `/payments/:id` → `/profile/payments/:id`, `/refer` → `/rewards`,
   `/refer/fitted` → `/rewards/invited`, `/replacement` → `/hair-system` (Your hair system, which says when the
   replacement opens and books it), `/photos/compare` → `/photos`.
4. **One component library.** Every new part is in `packages/ui`; the app holds screens. Toasts gain a full-width variant
   with a leading icon (`Toast`, `fullWidth`): ink, white words, 12 px from each side, above the tab bar or the action bar,
   2.6 seconds. A toast is only for what the client just did; news arrives as the banner and an inbox row; errors stay
   inline.
5. **No figure in the source.** Every price, duration and rule value is read from the API, which reads Settings · Rules
   and the price book. The law's own day counts (a grievance's and a deletion request's 30 days, invoices kept 8 years)
   come from the server's constants on `/api/me`. A test greps the app for amounts and hour or day counts.
6. **Words stay in the app** (owner, ruling 4): `apps/app/src/content*`, no Words-page keys. A state the prototype does
   not draw keeps its current words, restyled.
7. **Every current state survives**, including those the prototype does not draw (audit section 9).
8. **The client app's JavaScript budget is 200 KB**, gzipped, as the technician app's is (ADR 0247), not the brief's
   150 KB (owner, 16 November 2026). The redesign's screens, the live visit, the sign-off, the alerts and request mode
   take the first load past 150 KB, and the budget counts every chunk the service worker keeps. The console keeps 150 KB.
   Its first screen's largest paint on Lighthouse's slowed mobile profile is held under 2.75 s, not 2.5 s (owner, 16
   November 2026): the design's IBM Plex comes in three weights the sign-in screen draws, about 300 ms on a first visit;
   the service worker keeps them after it.

## Departures

Recorded as they are found while building; `docs/client-redesign/REPORT.md` lists them with the screens they touch.

- **A page under a tab has a way back and no tab bar**, as the prototype draws every page that is not a tab's own:
  Payments and invoices, one visit, and a page whose code is still loading the first time it opens, which draws its own
  head and, on a tab's page, the tabs. The page's action sits in the gutter under a hairline, as the prototype's footer
  does, never the screen's full width.
- **Past visits** have no photo thumbnail and no amount beside them: `GET /api/visits` carries neither. Each row is the
  visit's full date over what it was and who did it, a missed visit in red.
- **The tags.** Paid, signed off and refunded are green on their tint, as drawn. The prototype's brass words for In
  progress and Refund in progress fall under 4.5:1 on their wash, so a state to watch takes the look's navy
  (`--status-attention`).
- **A missed visit** has no "What happened" log and no "Book again" beside the dispute: the API keeps no such log for the
  client, and booking stays where every other visit is booked. The charge and any dispute are rows among the visit's
  facts, and "Were you home?" gives the last day to dispute.
- **The account** keeps "Signed in on", the sessions the prototype does not draw (every current state survives),
  between Your data and Delete account.
- **Visits' record** ("Your record": first fit, service visits, replacements, total paid) stays beneath Past.
