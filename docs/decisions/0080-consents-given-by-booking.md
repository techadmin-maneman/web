# 0080. The photograph consents, given by booking

- Status: accepted, for counsel to confirm before production (`docs/open-points.md`, item 148). Amended by ADR 0094: the console tells a consent given by booking by where it was given, not by its notice. Amended 2 October 2026 by the owner's ruling on the audit: Pay comes first, and the lines sit one tap away beneath it under "What booking agrees to"; the tap still agrees. Amended 2 October 2026 on the owner's decision (audit finding PS-28): the consents are recorded once the booking is confirmed, not at the tap; the photographs for the client's own record are worded as taken for their visit record; the reminder box and /book record notices of their own words.
- Date: 2026-09-27
- Amends [0042](0042-client-profile.md), whose consents were given only by the profile's switch, and [0048](0048-referrals.md), whose invite named a referrer only on the profile's notice; follows [0049](0049-dpdp.md) and records the owner's ruling of 27 September 2026 (ADR 0025, item 61)

## Context

The owner tried the client app on staging and found "Photographs for your own record" and "Photographs on referral cards" off in Profile, with nothing in the booking asking for them: "Set photographs for your own record, photographs on referral cards permissions as already given." A consent cannot simply be set; the client must give it. Asked how, the owner chose: booking a visit counts as agreeing to both, with the pay step saying so; Profile shows them as "Given" with a date; the client's yes is a real tap; the client can still switch either off in Profile; and the referral card's lines, "Your first name appears on your invite." among them, move onto the pay step.

Until now a consent was given only by the client's own switch in Profile, or, for cards, by board F3 in the share sheet, each on its purpose's current notice (`CURRENT_NOTICE`, `src/config/notices.ts`). An invite named its referrer only if their latest consent to cards was on `photos-referral-cards-v2`, the notice carrying the naming line (ADR 0025, item 24).

## Decision

**The tap that starts a booking is the agreement.** The DPDP Act 2023 asks that consent be "free, specific, informed, unconditional and unambiguous with a clear affirmative action" (s.6(1)). The pay step (boards C4 and C5) shows, above its button, what booking also agrees to and the referral card's lines; the client reads them and taps Pay, or Confirm visit. That tap is an act, not a default, and the lines say what it covers, purpose by purpose. `POST /api/bookings` takes the purposes the pay step showed (`consents`) and, once the booking has started (a Razorpay order made, or a free visit, one a credit covers included, sent to FSM), records each. A tap on a hold that has lapsed starts nothing and records nothing. A client who then closes Checkout without paying has still agreed, since the tap was made with the lines in view; they switch it off in Profile, as easily as it was given (s.6(4)).

> **Amended 2 October 2026 (audit finding PS-28):** the lines say "By booking this visit", so a consent is recorded only once there is a booking. The tap keeps on the hold the purposes shown and the client's hashed address (`slot_holds.consents_shown`, `consents_ip_hash`); they are recorded when the hold is confirmed: at once for a free visit, one a credit covers included, and for a paid one when Razorpay's webhook says it is captured, given at Razorpay's own time for the payment (`src/domain/booking-consents.ts`). A Checkout closed unpaid records nothing, and neither does a payment made too late, whose hold is let go and refunded. A purpose the client decides between the tap and the payment stays as they left it.

**Only what the client has never decided.** The rule is `agreedByBooking` in `src/policy/booking.ts`, in the owner's words: "Booking a visit in the app agrees to photographs for the client's own record and on referral cards, each only while the client has never decided on it." Never decided means no row in the consent ledger for that purpose. A purpose the client switched off is never switched back on by a booking, and the pay step does not show its lines; one they switched on is left on its own notice. The write itself settles it (`grantIfUndecided`, `src/domain/profile.ts`: the row goes in only where the purpose has none), so two taps, or a tap racing the profile's switch, record it once. Nothing shows when both are decided.

**The same ledger, and the same audit entry.** Each consent is a row in `consents`, append-only as ever, with the time the booking was confirmed and the hashed address of the client who tapped, and a `consent.switch` audit entry naming the hold, written only if the row was (`auditStatementIfWritten`). Profile then shows both as "Given" with their date, unchanged.

**A notice for exactly the lines shown.** A consent row names the notice the client saw, and the pay step's lines differ from the profile's, so four notices are added, each the pay step's lines word for word:

| Asked                  | Photographs for your own record      | Photographs on referral cards            |
| ---------------------- | ------------------------------------ | ---------------------------------------- |
| Both                   | `photos-own-record-booking-v1`       | `photos-referral-cards-booking-v1`       |
| One, the other decided | `photos-own-record-booking-alone-v1` | `photos-referral-cards-booking-alone-v1` |

Both lines read "By booking this visit, you also agree to …", the card's five lines follow wherever cards are asked, naming line included, and the last says the client can switch it, or either, off in Profile.

> **Amended 2 October 2026:** the owner's decision words the first purpose "Photographs taken for your visit record", so the lines that name it are recorded as `photos-own-record-booking-v2`, `photos-referral-cards-booking-v2` (both asked) and `photos-own-record-booking-alone-v2`; cards asked alone keep `photos-referral-cards-booking-alone-v1`. The profile's switch records `photos-own-record-v2`. Rows on the earlier versions keep them, and a card consent on any of them still names its referrer. The app composes the same lines (`apps/app/src/booking/consents.ts`), and `test/node/app-consent-lines.test.ts` holds them to the notices, so the notice recorded is the text shown.

**`CURRENT_NOTICE` does not change; the naming check takes a set.** `CURRENT_NOTICE` is what the profile's switch and the share sheet show, and they still show `photos-referral-cards-v2`. The invite names its referrer when their latest consent to cards is on any notice carrying the naming line: `NAMING_NOTICES`, read from the notices' own text, so a later notice that carries it counts without anyone remembering to add it. The share sheet's F3 step is asked only when that consent does not stand (`GET /api/refer`'s `card.consented` reads the same check), so a client who agreed by booking is not asked again, and one who never booked in the app is asked there as before.

**A move gives nothing.** A move is started by `POST /api/appointments/:id/reschedule`, which takes no consents, and `POST /api/bookings` records none for a hold that moves a visit.

**Ops can tell them apart.** The console's consent tab writes the notice less its purpose, so a consent given by booking reads "booking-v1" where the profile's reads "v2". (Amended 28 September 2026 by ADR 0094: each consent records where it was given, and the tab writes that instead, "Booking" for these and "Profile" for the profile's.)

## Consequences

- **Counsel confirms this before production** (open point 148): whether a consent the booking cannot be made without is "free" and "unconditional" under s.6(1), or the pay step needs a way to decline each purpose; and the lines. The owner approves the words, placeholders in `apps/app/src/content.ts`.
- A client who books in the app is named on their invite, and their card may carry their photographs, without opening the share sheet's F3; the lines telling them so were on the pay step.
- A client who booked before this, or books on the site or through ops, is asked as before: in Profile, or in the share sheet.
- The pay step is taller for a client who has decided neither purpose; boards C4 and C5 are shot with both decided and are unchanged (`docs/fidelity-method.md`).
- The booking sheet's "Remind me on WhatsApp the day before" is the client's own tick, recorded at the tap through the profile's route, now under a notice of that line (`whatsapp-visits-booking-v1`); /book's agreement is recorded as `site-consultation-v1`, the invite page's line in the same words, so a /book booking no longer names a referral notice.
- Tests: `test/worker/booking-consents.test.ts` (nothing at the tap of a paid visit, recorded on the capture at the payment's time, nothing for a payment made too late, undecided only, never re-granted, the audit entry, a credit visit, a lapsed hold, a move); `test/worker/referrals.test.ts` (the landing and the refer page name a referrer whose card consent came from a booking); `test/worker/notices.test.ts`; `test/node/policy-booking.test.ts`; `e2e/app/booking.e2e.ts` (the lines shown only while undecided, and sent with the tap).
