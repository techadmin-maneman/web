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
2. **The client's hair system on `/api/me`.** `hair_system {package, since, replace_after_months, bookable_from}`, from
   the same window, so Home can say month n of N and the day its replacement opens.
3. **The package is chosen at booking.** The replacement's tier step marks each package Keep it, Upgrade, Downgrade or
   Switch, with its replacement and service prices and lifespan from the price book. `people.package` moves on booking,
   as ADR 0211 says.
4. **Stocked as booked.** `codeFor` takes the booked tier for a replacement, as for a first fit, so demand, kits and
   `stock_at_risk` follow the booking.
5. **The old package's hair system returns to stock.** Where the booked package differs from what the
   `replacement_order` task ordered or set aside, the task closes as "returned to stock" and that hair system becomes
   ordinary stock. Nothing is charged to anyone.
6. **Not in stock in the client's size.** The order is raised on the booking (ADR 0174's path), at no cost beyond the
   package's own price, and start times open only from its promised date. The booking step says so.
