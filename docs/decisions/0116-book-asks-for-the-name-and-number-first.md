# 0116. /book asks for the name and number first

- Status: accepted
- Date: 2026-10-11
- Topic: Booking and visits
- Amends [0051](0051-booking-from-the-site.md): the site's own page books in steps; the invite's page is as it was

## Context

/book was one long form after the pincode: what to book, the day, the window, seven parts of the address, the hair loss, then the name, the number and the agreement. Someone who stopped halfway left nothing behind, and nobody could call them. The owner chose to ask for the name and number first, keep them as a lead, then ask the rest in short steps (audit SITE-07).

## Decision

1. **Four steps, each with its place shown:** the name, the number and the consultation's agreement; the pincode; the visit (what to book, the day and the window); the address, the hair loss, any discount code and the remembered invite. Where we do not come, the third step is the list, which asks only for its own agreement and the launch alert.
2. **The first step is kept at once.** `POST /api/lead` checks Turnstile and the day's limits as a booking does, records the agreement under the consultation's notice, and writes a lead with no day (`src/domain/booking/public-lead.ts`). The CRM receives it as any lead, and the chat line says it is a name and number at the first step.
3. **Every number gets the same answer.** Nothing is written for someone who has had a visit, or booked or asked for one, and a second lead in a day is not written.
4. **The booking is unchanged.** It still sends the name and number, so it stands alone; its lead goes to the same CRM record, which the person's `zoho_lead_id` already names.
5. **The invite's page is not changed.** The design draws it as one form (boards C1 to C5).

## Consequences

- The first step and the booking each take one of the number's five tries a day (`LEAD_MOBILE_DAILY_LIMIT`).
- Changing the name or number goes back to the first step, and the visit and address are asked again.
- Back and Forward move through the steps (`site/src/islands/invite/history.ts`).
- Tests: `test/worker/site/public-lead.test.ts`, `e2e/book.e2e.ts`, `e2e/book-api.e2e.ts`.
