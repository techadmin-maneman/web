# 0198. Cities as data

- Status: accepted
- Date: 2026-10-14
- Topic: Platform
- Amends [0109](0109-console-departments-and-access.md)

## Context

The seven cities and the NCR zone existed only through migrations, so opening a city needed a developer and a release. Each city's state, which a visit's GST place of supply turns on, was a constant for the five NCR cities; any other city fell back to the state registered in, so a Mumbai visit would have been invoiced with Haryana as its place of supply. The model held one GST registration, and every price and rule was national.

## Decision

1. **A city is a row ops edit** at Admin › Cities, every change audited: its name, its state (the GST code Books names a place of supply by, and the state's name), its zone, whether it is served and whether it is offered at all. Adding one is an insert, not a migration.
2. **The name stays the city's key.** Every table that names a city names it by its name, so a rename (Gurgaon to Gurugram) moves every row that names it in one batch: the new row first, then each reference, then the old row (`renameCity`, `src/domain/cities/cities.ts`). `test/node/database/city-columns.test.ts` fails when a table gains a city column the rename does not move.
3. **The place of supply is the visit's city's state**, read from the row; with no city known, the state registered in.
4. **GST registrations by state** (`gst_registrations`): a visit in a state with a registration of its own is supplied from it, and its Books invoice names that registration's Books branch; any other is supplied from the registration in `BOOKS_GSTIN`. Which registration supplies a visit across states is the CA's to confirm before a second one is added.
5. **A city may differ from the national price and rules.** A price in force for a city (`city_prices`) comes before the national one for the same service; the check-in radius and the reminder hour may each be set for a city (`city_settings`), and a city that sets none follows the national rule. Care's hours stay national: one Care team answers every city from one inbox, and its reply clock, its numbers and its tasks count by one set of hours. A city with hours of its own comes with a Care team of its own.
6. **A served pincode is in one of our cities**: the database refuses one that names another.

## Consequences

- Opening a city: add it at Admin › Cities with its state and zone, add its pincodes in the service area, and give it prices or rules of its own only where they differ.
- Production's Books carries one registration until a second state's is registered; the branch is named on an invoice only once a registration names one.
- Tests: `test/worker/ops/cities.test.ts`, `test/node/policy/gst.test.ts`.
