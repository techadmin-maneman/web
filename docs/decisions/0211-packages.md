# 0211. Packages

- Status: accepted
- Date: 2026-10-18
- Topic: Booking and visits
- Amends [0085](0085-services-ops-can-edit.md), [0086](0086-the-next-visit-is-offered.md) and [0156](0156-hair-systems-in-stock.md); retires the replacement cycle by base

## Context

A product existed only as a first fit's service code. Its hair systems had a cost and stock levels but no selling price. One service visit (90 minutes) and one replacement (135 minutes) served every product, at one price each. Service visits fell due on one 30-day setting, and a hair system on its base's cycle.

On 18 October 2026 the owner asked for packages. Each package, such as Mane Man Essential, has hair systems that are independent stock codes with their own price, sizes, grey and density; a service visit with its time, how often it falls due, and its cost; and a replacement with its cost, the months until it falls due, and its time. A client chooses a package. They get the hair system with a service visit at the first fit, service visits after, and a replacement with a service visit when it falls due. The owner approved the plan (https://claude.ai/artifact/FB1iYqD51fxTq9KvHQoiHp). A hair system has no time of its own: the visit it is fitted at has it. Every hair system has its own price, and ops add, change and delete packages and every part of them.

## Decision

1. **A package** is a row of `packages` under a code, with how often its service visit falls due (`service_every_days`) and how many months its hair system is worn (`replace_after_months`). Its first fit, service visit and replacement are three rows of `services` under the same code. The first fit's row holds the package's name, description, order and retirement; the other two are named from it ("Mane Man Essential service visit").
2. **Its hair systems** name it as their product (`hair_systems.product`). Each sells at a price of its own: a row of the price book under `hair_system` and its stock code.
3. **A first fit costs** the hair system made to the client's hair profile and the package's service visit. Before a profile matches one, it is offered from the package's cheapest hair system. A first fit has no price-book row of its own, and one is refused.
4. **A replacement costs** the replacement's own price and the service visit's. **A service visit** costs its own.
5. **One bundled line.** The visit is invoiced as one line at the sum, at the GST of what it is chiefly for: the hair system, or the replacement (the CA's advice of 18 October 2026).
6. **The client's package** is `people.package`. Booking a first fit or a replacement of a package puts the client on it; so does ops' choice on the client's record. Before either, their consultation's recommendation stands in. Their service visits and replacements are their package's, and the standard ones while they are on none.
7. **When visits fall due.** A service visit falls due its package's days after the visit before. A hair system falls due its package's months after it is fitted, on the same day of the month. These replace the single cadence (`booking_days.service_cadence`) and the base cycles (`piece_cycle_days`). A package's cadence may not pass how far ahead clients may book (`horizon`); a horizon short of one is refused.
8. **Retiring** a package stops its first fit being sold, and its clients keep their service visits and replacements. **Deleting** one is refused once anything was sold under it, a client is on it or was recommended it, or a hair system names it.
9. **Today's products became packages** (migration 0190), each with the standard service visit's and replacement's figures. Their prices were split so every total stayed as it was: each hair system at its first fit's price less the service visit, each replacement at the old price less the service visit.

## Consequences

- Settings · Packages lists the packages and opens each one's record: its hair systems, its service visit, its replacement and what each costs us. Settings · Hair systems is gone, and Services keeps the consultation and the late fees.
- Ops book a client's own package's service visit and replacement, and see a first fit at the client's own price.
- The data export gives the client's package by its name.
- Tests: `test/worker/money/ops-packages.test.ts`, `test/worker/ops/ops-client-package.test.ts`, `test/node/policy/policy-packages.test.ts`, `test/node/database/migration-0190.test.ts`.
