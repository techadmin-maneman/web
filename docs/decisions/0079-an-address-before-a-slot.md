# 0079. An address before any slot

- Status: accepted
- Date: 2026-09-27
- Topic: Booking and visits
- Amends [0045](0045-self-serve-booking.md), whose holds took any client; follows [0054](0054-address-capture.md) for the form, and records the owner's ruling of 27 September 2026 (ADR 0025, item 60)

## Context

The owner tried the client app on staging and booked a slot without giving an address: "Why are they able to book a slot without giving their address? Address should be asked before confirming a slot, not later."

That was how it was built. The booking sheet went from the date to the window to paying, and read the profile only to know whether reminders were on. `POST /api/holds` held a slot for anyone, and a hold's pincode was the saved address's, or else the pincode of the client's last booking, or none. The address was asked for only afterwards: by Home's prompt (board B1, ADR 0025, item 44) and by Profile's "Where we come". A technician could be sent to a visit whose door nobody knew.

## Decision

**No slot is held until the client has given their address.** `POST /api/holds` answers `409 address_required` when the client has no saved address, for a new visit and for a move alike. The rule is `isFullAddress` in `src/policy/booking.ts`, in the owner's words: "A client gives their full address before a slot is confirmed." A saved address is a full one, since `PATCH /api/profile/address` takes none without its building or street, area, city and six-digit pincode; the check says so once, where the rule lives, for any other way an address comes to be saved.

**A hold carries the saved address's pincode, always.** The fallback to the last booking's pincode could only serve a client with no address, and there are none now, so it is gone (`bookingPincode` in `src/domain/booking/holds.ts`).

**The booking sheet asks for the address first.** When the profile has no address, the sheet's first step is the address, before the date, since which windows we can offer depends on where the client is. It is Profile's own form, with the building search (`apps/app/src/profile/AddressForm.tsx`, shared by both, ADR 0054), headed by Profile's "Where we come", and it numbers the sheet's steps one to four where the boards number the date and window one and two of three. Saved, the sheet asks for the days again and goes on to the date. A hold the API refuses with `address_required` (the profile could not be read, or the address went meanwhile) sends the sheet back to the address with a line saying why. A client who has an address sees boards C2 to C6 exactly as before.

**Home's prompt for an address stays.** A visit booked on the site or by ops before this, or by ops still, can have no address; Home asks for one while anything is booked, and the Tasks board's Address to confirm stays (ADR 0074).

**The site's booking forms** take the address as well, in their own change (ADR 0081; ADR 0025, item 62).

## Consequences

- No board draws the address step. Its heading is the profile's, and its other words are placeholders in `apps/app/src/content.ts`; the departure is listed in `docs/fidelity-method.md` beside board C2.
- A client without an address takes one more step before their first booking in the app, once.
- A move is refused for want of an address as a new visit is. A client who moves a visit ops booked for them, with no address, gives it first.
- Tests: `test/node/policy/policy-booking.test.ts` quotes the rule; `test/worker/booking/client-booking.test.ts` holds no slot and moves no visit without an address, and holds one at the saved address's pincode; `e2e/app/booking.e2e.ts` asks a client with no address for it first, then books, and takes a client with one straight to the date.
