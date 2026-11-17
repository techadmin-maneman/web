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
- **Home's card** says when the technician arrives and for how long, where, and what it costs now (paid ahead, free, or
  what is left to pay at the visit); with nothing paid ahead and nothing to pay, it says nothing of money. The
  technician is named by first name, as before. A visit a free service visit covers reads "Paid", as Visits tags it:
  the API carries one Prepaid flag for paid ahead and covered by a credit, not the prototype's "Free service visit". Home's prompts (the address to add, an invoice to open) are rows. The
  open issues are a count, not the issue itself, and the last visit has no thumbnail or photo count: `/api/me` and
  `/api/visits` carry neither.
- **The consultation's steps** take the prototype's first two, and a third that is true of a consultation alone: the
  first fit is booked if the client goes ahead, and nothing is fitted on the day. Fitting on the day is a consultation
  and fit, booked as such, with its own steps.
- **Rewards** shows the ways to send the invite, the invite as the friend sees it, the friends fitted and how it works,
  as drawn. Choosing the card and agreeing to the photographs on it stay in the share sheet those ways open, where the
  consent is recorded before any card is made; the page's "Change the picture" opens it too.
- **Privacy and messages** groups the switches as drawn. Its first line keeps the words the booking records as the
  photographs' consent (`VISIT_PHOTOS`), not the prototype's, so the two never differ.
- **Address**: with no address yet, the page is the form, as drawn; a saved address shows as written, with Edit, so the
  client can check what was typed for them.
- **Notifications** has no "Mark all read": opening the inbox marks them read. A new one is marked by a small brass
  square, not a dot: corners stay square (ruling 10).
- **Sign in** keeps no example number as a placeholder.
- **The live card** gives the technician's word without "Also sent to you on WhatsApp": the app cannot know the client
  takes WhatsApp updates.
- **Change** opens on two rows, Move to another time and Cancel the visit, under the visit's name and day ("Service visit
  on Fri 20 Nov", or "Consultation and fit"), as the card names it, without the hair system's tier. The prototype's third
  row, Add a note, is the card's own button beside Change. The rows carry no second line: what moving costs is the line
  above them, and what cancelling gives back is the cancel step's, which reads the API's terms before anything is
  cancelled. A consultation's rows read as any visit's.
- **Booking** is the design's full screen: a head with the way back and out, a step bar, and the step's button in a
  footer. The day and the time are one step, as drawn. The days come a fortnight at a time, as the API gives them, and
  "Later dates" beside the month adds the next; the prototype draws every day at once. A day with a time inside the
  notice is no longer marked on the strip: the time chosen says so above Continue.
- **The review** keeps the I-agree tick (ruling of 25 October) and the WhatsApp reminder's tick, and the photographs'
  line in the notice's own words. It has no switch to use a free service visit, since the API applies one to the hold
  itself and the review says it is used, and no note box, since a note is kept on a visit, which exists once booked:
  the booked screen's "Add a note" writes it. Change beside the address lets the time held go and opens the address
  form; a move shows no address, since it keeps its visit's own. Back and Change are offered only until Checkout has
  an order for the time held: the API keeps an ordered hold until its grace ends and hands it back for the next time
  picked, so from then on Pay is the way on. Once GST applies its split sits under the total, and a first fit's length
  under its name. A failed payment, and Checkout closed unpaid, are said at the review's head, and Pay tries again, as
  drawn.
- **Booked** names the technician the API holds rather than "Confirmed the day before", and leaves out "If yours
  changes, we tell you on WhatsApp": a swap tells the client nothing (the brief's ruling 5; ADR 0115). The reminder the
  day before is promised only to a client who has switched on WhatsApp about their visits.
- **The waits**: the design's "Waiting for your bank" is said as "This is taking longer than usual", with what happens
  next: the app cannot tell a bank's wait from the booking's own. A wait that ended without a booking (that one, or a
  refund) has Close at its foot.
- **The replacement's choice of hair system** offers every replacement on sale, `/api/me` listing them all once a
  replacement may be booked, and opens on the one worn. Each is the library's choice card, its ticked look with a tick
  box, not the prototype's radio dot, and is marked by its replacement price against the one worn's: Upgrade,
  Downgrade, or Switch at the same price or where the one worn's is not known; the price book has no rank. Its note
  says "Any … hair system ordered for you goes back to stock, at no cost to you", not "The … we set aside for you costs
  you nothing": nothing holds a hair system for a client (ADR 0253, decision 5). Where the one chosen is not in stock
  in the client's size, the days say so and when the earliest fitting is (decision 6); in a size no stock code matches,
  the days give way to "Made to order in your size" and a way to ask on WhatsApp, ops ordering and booking it. "Not
  sure? Ask us" opens WhatsApp, the app's way to ask. Where
  the packages' figures cannot be read, each choice keeps its name and price.
