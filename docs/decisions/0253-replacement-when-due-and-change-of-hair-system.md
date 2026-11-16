# 0253. Changing hair system at the replacement booking, and when a replacement is booked

- Status: accepted
- Date: 2026-11-12
- Topic: Booking and visits
- Amends [0086](0086-the-next-visit-is-offered.md) on when a replacement may be booked, and
  [0211](0211-packages.md) on stocking a replacement booked as another package

## Context

Two faults the client redesign's sync audit found (C1, C2). Any fitted client could book a replacement at any time
(`bookableTypes`, `src/domain/booking/availability.ts`), though ADR 0086 offers it only once the hair system falls due.
And a replacement booked as another package was stocked as the old one: stock demand coded a replacement from the hair
profile's product, never the package booked (`codeFor`, `src/domain/purchasing/stock-demand.ts`), so a client who chose
Natural in place of Active had an Active hair system ordered, kitted and carried to the door.

The owner ruled on 12 November 2026 (rulings 1 and 2): a replacement happens only when the hair system ends; the client
picks keep, upgrade, downgrade or switch while booking it, with no notice owed; the hair system already ordered for the
old package goes back to stock for other clients, and nobody pays for it.

## Decision

1. **When.** `replacement` is bookable from the first day of the month the hair system falls due, within
   `booking_days.horizon`, and not while one is booked or paid for. Never otherwise. The app's booking routes and ops'
   (`saleFor`) refuse it with `not_bookable`. One owed free, by a remake or a recall (ADR 0192), is bookable at once,
   by ops, who book it free; the app sells the client none meanwhile. "Or book a replacement" goes from Home and Visits.
2. **The client's hair system on `/api/me`.** `hair_system {package, name, fitted_on, replace_after_months, due_on,
replacement_opens_on}`, from the piece in wear and the package it was fitted under, so Home can say month n of N and
   the day its replacement opens.
3. **The package is chosen at booking.** The replacement's tier step marks each package Keep it, Upgrade, Downgrade or
   Switch, with its replacement and service prices and lifespan from the price book. `people.package` moves on booking,
   as ADR 0211 says.
4. **Stocked as booked.** One rule names a fit's product (`bookedProduct`, `src/domain/inventory/hair-systems.ts`): the
   package booked, at a first fit or a replacement; the standard one for a first fit booked with none; the product worn
   for a replacement booked with none. Demand and `stock_at_risk`, the evening's kit check, the forecast, who takes the
   fit and the stock gap told at booking all read it.
5. **The old package's hair system returns to stock.** Nothing holds a hair system for a client, so one ordered for
   the package they wear is ordinary stock already. Where the replacement is booked as another package, each piece's
   `replacement_order` task closes with "Returned to stock: the replacement is booked as …", by the system, in the
   booking's own batch. Nothing is charged to anyone.
6. **Not in stock in the client's size.** Where no place holds the stock code made to the client as the package asked
   for, the app's days open from today and the quickest supplier's lead time for it (`stockArrivesOn`, through
   `rangeFor`), and a hold before then is refused; `stock_at_risk` tells ops to order it once the replacement is booked.
   A code some place holds opens as usual, ops moving it. A size no stock code matches is made to order, which ADR
   0174's custom order takes payment for first: how that goes at a replacement, at no cost beyond the package's price,
   waits on the owner. The booking step says when the days open.
