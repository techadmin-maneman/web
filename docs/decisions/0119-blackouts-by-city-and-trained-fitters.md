# 0119. Blackouts by city, and trained fitters

- Status: accepted
- Date: 2026-10-11
- Topic: Booking and visits
- Amends [0088](0088-every-policy-in-the-console.md): a closed day may name one city

## Context

A closed day closed every city, so a local holiday in Mumbai closed Delhi too. And nothing was known of who can fit a hair system: any technician in the city was offered a first fit, or the consultation and fit in one visit.

## Decision

The owner's rulings, 11 October 2026:

1. **A day may be closed in one city.** `city_blackouts` holds a city's own closed days beside `visit_blackouts`' days closed everywhere. A visit's day is closed where either closes it, by the visit's city: its pincode's, else its client's address. Settings' Closed days chooses Every city or one.
2. **A first fit goes only to a technician trained to fit.** `technicians.fits_trained`, which ops set on the technician's page, is read wherever a technician is offered or given a first fit, the one visit among them: the app, the site, ops' booking and the dispatch board (`not_trained`). A visit keeps its own technician through a change of time.

   > **Amended 11 October 2026 (the owner's ruling):** a replacement fits a hair system too, so it goes only to a technician trained to fit, by the same checks (`isAFitting`, `src/config/visit-types.ts`).

3. **A technician carrying a hair system** is the owner's other condition for a first fit. Stock counts consumables, not hair systems, so it waits for hair systems to be stock that a kit holds (the inventory scope).

## Consequences

- Staging's technicians were not marked trained when this landed: until ops mark them, no first fit is offered there.
- Both changes are expand only (migration 0107).
- Tests: `test/worker/booking/technician-city.test.ts`, `test/worker/ops/ops-blackouts.test.ts` and `dispatch-landing.test.ts`.
