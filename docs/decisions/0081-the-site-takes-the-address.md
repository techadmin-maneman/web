# 0081. The site takes the address before it books

- Status: accepted
- Date: 2026-09-27
- Amends [0051](0051-booking-from-the-site.md), which asked for no address; the site's side of [0079](0079-an-address-before-a-slot.md); records the owner's ruling of 27 September 2026 (ADR 0025, item 62)

## Context

The owner tried the client app on staging and ruled: "Address should be asked before confirming a slot, not later." Asked whether the website's booking forms — `/book`, and an invite's `/r/:code`, which asked only for a pincode — should take the full address too, the owner answered: **site too.**

ADR 0051 had said the opposite: "It does not ask for an address. The pincode is enough to know whether we come; the technician takes the rest on WhatsApp, as before." So a consultation booked on the site reached FSM with a city and a pincode, the client app said "No address yet" until the client typed one, and Home and the Tasks board asked for it afterwards (ADR 0025, item 44; ADR 0074).

One thing ADR 0051 said was not so. It described the landing's slot as "held for ten minutes while the form is filled in". Nothing is held while the form is filled in: the slot is held when the form is sent, and confirmed as it is held (`holdSlot`, `from: "site"`, in `src/domain/scheduling.ts`).

## Decision

**The consultation form asks for the address, in the form that books.** Once the pincode is found served, the form asks for the day, the window, then where the consultation is, then (on `/book`) where the hair loss is, the name, the number and the agreement. Nothing is held until the form is sent, and it is not sent without the address, so no slot is confirmed without one. The address comes after the day and the window, as the slot was held before: when and where, then who. The waitlist form asks for no address, since nothing is booked.

**The fields and their rules are the client app's.** Flat or house number; floor, and tower or block (optional); building, society or street; street (optional); landmark (optional); sector or area; city; access notes (optional), with the app's line on what they are for. The building or street, the area and the city are required, as `AddressSection` requires them; a part left out is marked, and says so beneath it, as the name and the number do. The city starts as the checked pincode's, and the client may change it. The pincode is the one the page checked: it is shown, not asked again, and "Change" beneath the form's heading goes back to the check. The helpers are `site/src/lib/address.ts`, the fields `site/src/islands/invite/AddressFieldset.tsx`.

**No building search on the site.** The app's search needs a client session, and every search spends from a capped Google allowance (ADR 0054: `GEOCODE_DAILY_CEILING`, and 120 a client a day). An open form would let anyone spend it. So the site takes typed fields only, and the address it saves has no Place ID and no pin. A check-in at it is unmeasured (ADR 0036) until the client chooses their building in the app, which geocodes it then.

**The API.** `POST /api/consultation` and `POST /api/r/{code}/consultation` take `address`: the app's `Address` schema (`src/routes/client-profile.ts`) without `building` and `place_id`, which only the search fills, published as `TypedAddress`. A body without it is refused `400 invalid_request` naming `address`, as a body missing any other field is. An address whose pincode is not the one booked at is refused `422 invalid_request` naming `address.pincode`: the technician goes to the address, and it is the pincode that said we come there. The waitlist routes are unchanged.

**It becomes the person's address.** It is written with the statements `saveAddress` writes, in the booking's own batch — with the person, their consent and the held slot, or the request while self-serve booking is off — so a window that has gone leaves no address behind (ADR 0068). A person who already had an address has it replaced, exactly as editing it in the app does: the old one is kept, marked replaced. The app's profile shows the new one.

**FSM and the CRM take it.** Someone new is added to FSM by their booking, whose contact reads the saved address (`fsmContactOf`, `src/domain/fsm-contacts.ts`): its street and pincode go on the contact's service address, and the work order takes that address. The contact now takes the saved address wherever it is in the booking's pincode, and not only where its city is spelt as the pincode's: a client who typed "Gurugram" for a pincode whose city is Gurgaon gave FSM no street. Someone we knew before may be in FSM and the CRM already, with an older address or none, so their booking sends the new one on to their FSM contact and CRM lead (`queueContactSync`, ADR 0070), as an edit in the app does. The CRM lead carries the city, as it always has; no new Zoho field is needed. While self-serve booking is off, the request waits for ops as before (ADR 0060), and the console's client page shows the address.

**The privacy page says so.** It now says the address given when booking is kept, what it is for, where it is held, and for how long. The rest of the page is the notice of 22 September 2026, whose Phase 2 wording counsel owes (item 44), and these lines wait for counsel too (`docs/open-points.md`, item 148). Its line on a number given at the try-on's gate is not this change's (item 146).

## Consequences

- **No board draws the fields.** Board C2 of design/phase2/Referral and Waitlist, which `/book` follows too (ADR 0051), draws no address; the departure is ADR 0025, item 62, and `docs/fidelity-method.md`, beside C2. Its words are the client app's own, in `site/src/content/referral.ts`, and wait for the owner with the site's other undrawn words (`docs/open-points.md`, item 45). They are not marked `PLACEHOLDER`, as the apps' are: that mark refuses the site's production build (`scripts/lib/content-gate.ts`), which the public site must keep passing (`test/node/site-production-gate.test.ts`).
- **The form is longer:** nine fields, three of them required, between the window and the name.
- **The form needs no login, only a number.** Whoever types a number books in that person's name, as before, and now replaces that person's address too. Only a number with no consultation to come and none behind it can book from the site (ADR 0068), so no client past a consultation can have their address changed this way, and the old address is kept.
- **The address has no pin** until the client chooses their building in the app.
- **FSM's service address still has no flat, floor, tower or landmark.** `streetOf` gives FSM the building or street, the second line and the area, as it did before this change; the technician reads the whole address from our API. That gap is the app's as much as the site's, and is `docs/open-points.md`, item 149.
- Home's prompt for an address, and the Tasks board's Address to confirm, no longer arise from a booking on the site; they stay for visits ops book.
- Tests: `test/worker/consultations.test.ts` ("the address the consultation is at") and `test/worker/referrals.test.ts` refuse a booking without an address and one in another pincode, save it so the app's profile shows it, write it with a request, replace an earlier one and send it on, and give FSM its street however the city was typed; `test/node/site-booking.test.ts` holds the form's rules; `e2e/book.e2e.ts` stops a booking without it at the form with its parts marked, and `e2e/book.e2e.ts`, `e2e/refer-landing.e2e.ts` and `e2e/book-api.e2e.ts` book with it.
