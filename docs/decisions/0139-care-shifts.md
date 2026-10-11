# 0139. Care on shift

- Status: accepted
- Date: 2026-10-12
- Topic: Messages and the CRM

## Context

The support scope has Care staff mark themselves on or off shift, and a chat whose Care person is off shift go to whoever is on shift with the fewest open chats. ADR 0134 built cover from days off and leave alone. The scope also gives a Care person at the first chat or the first booking, whichever comes first, and the app's Support card shows the Care person with Care's hours.

## Decision

1. **Each member of the Care team marks themselves on or off shift**, on the Messages page, from the Care team panel. It sits there rather than in the console's header, which loads on every page within a few hundred bytes of its budget.
2. **A Care person off shift, or on a day off or leave, is covered** by the member on shift, and not on a day off, with the fewest open chats. Each cover takes on the chats of whoever they cover before the next is placed. With nobody on shift, nobody covers, and each chat stays with its Care person.
3. **A client is given a Care person at their first booking** as well as their first chat: whichever comes first.
4. **The Support card reads "Asha, your Care person · 9 am–9 pm daily"**, from the Care hours setting.

## Consequences

- Shifts are not audited: going on and off shift changes no client's record, and every call is logged anyway.
- Tests: `test/worker/care/cover.test.ts`, `test/node/policy/care-cover.test.ts`, `test/worker/booking/booking-in-request.test.ts`, `test/dom/ops-messages.test.ts`, `test/dom/app-support-card.test.ts`.
