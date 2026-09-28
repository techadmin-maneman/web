# 0094. Where a consent was given, and an erasure blanks a check-in's coordinates

- Status: accepted, on the owner's rulings of 27 September 2026 (`docs/open-points.md`, item 50; ADR 0025, ruling 34)
- Date: 2026-09-28
- Amends [0049](0049-dpdp.md), whose consent record held no place and whose erasure left a check-in's coordinates, [0019](0019-erasure.md), [0066](0066-erasure-all-or-nothing.md), which left the coordinates open, and [0080](0080-consents-given-by-booking.md), whose consents the console told apart by their notice; records a departure in ADR 0025 (item 79)

## Context

**A consent kept no place.** Each row of `consents` holds the purpose, the notice's version, whether it was given, the date and the hashed address, and nothing of where it was given. Board B3, a client's consents in the console, draws a fourth column, "Source", with "App" or "Site"; the console wrote the notice's version there instead, since nothing recorded a source (`docs/fidelity-method.md`). The owner ruled on 27 September 2026 that a consent records where it was given: "the site's form, a booking in the app, the profile's switch, the technician".

Several places write the same notice. The landing's consultation line (`referral-consultation-v1`) and its waitlist line (`waitlist-v1`) are also `/book`'s, since `/book` became the landing without its invite (ADR 0051). The profile's switch (`PATCH /api/consents/{purpose}`) is also what the booking sheet's "Remind me" and the share sheet's card step (board F3) call, on the same notices. So the notice alone does not say where most consents were given.

**A check-in kept where the phone was.** `checkins.lat` and `lng` are where the technician's phone was when they checked in at the client's door, with `accuracy_m`, what the phone claimed of its fix. An erasure left them, as the technician's record, and ADR 0066 left it open. The owner confirmed ruling 34 on 27 September 2026 "with the coordinates blanked": an erasure also blanks a check-in's coordinates.

## Decision

### Each consent keeps its place

`consents.source` names where the consent was given, from a closed set, `CONSENT_SOURCES` in `src/policy/consents.ts`:

| Source             | Where                                                                                                                             | Written by                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `site_booking`     | The site's booking form, `/book`; Phase 1's form before it                                                                        | `POST /api/consultation`; Phase 1's `POST /api/lead`             |
| `site_waitlist`    | The waitlist on `/book`, for a pincode we do not serve yet, with its launch alert                                                 | `POST /api/waitlist`                                             |
| `referral_landing` | A friend's invite, `/r/:code`: its consultation or its waitlist, with the launch alert                                            | `POST /api/r/{code}/consultation`, `POST /api/r/{code}/waitlist` |
| `try_on`           | The site's try-on: the photo notice and the gate                                                                                  | `POST /api/tryon/claim`                                          |
| `app_booking`      | A booking in the app: the pay step's photograph lines (ADR 0080), and the booking sheet's "Remind me"                             | `POST /api/bookings`; `PATCH /api/consents/whatsapp_visits`      |
| `app_profile`      | The profile's switch                                                                                                              | `PATCH /api/consents/{purpose}`                                  |
| `app_share_sheet`  | The share sheet's card step, board F3                                                                                             | `PATCH /api/consents/photos_referral_cards`                      |
| `technician`       | The technician's app. Nothing asks for a consent there yet; the owner named it, so it has its place when one does                 | None yet                                                         |
| `erasure`          | The withdrawal an erasure records for each purpose the person had given (ADR 0019), from ops' decision or the operators' endpoint | `erasePerson`                                                    |

Ops never grant a consent, and no ops path writes one but the erasure.

**Every writer names its place.** A function that writes a consent for its caller takes the place as a typed argument (`switchConsent`, `grantIfUndecided`, and the site's forms through `bookConsultation` and `joinTheWaitlist`), so a caller that leaves it out does not compile; a writer with one place (Phase 1's form, the try-on's claim, the erasure) names it in its statement. `test/node/consent-writers.test.ts` fails on any `INSERT INTO consents` that does not name `source`. The column has no `CHECK`: like `AUDIT_ACTIONS` (ADR 0031), the set lives in code, since a `CHECK` could change only by swapping the column of an append-only table.

**The app says which of its screens.** `PATCH /api/consents/{purpose}` takes `source`, one of `app_profile`, `app_booking` and `app_share_sheet`, and the app sends it from each screen. It is optional: an app still open from before this release sends none, and its switch is recorded with none, rather than refused or given a guessed place. The same answer from another screen is still not a new answer (ADR 0058).

**Rows written before.** Migration 0057 gives an old row the place its notice was shown in only where that notice was only ever shown in one place, and leaves the rest empty. Never a guess:

- `booking-v1`, Phase 1's form: `site_booking`;
- `photo-v1`, `photo-v2`, `gate-v1` and `gate-v2`: `try_on` (the app shows try-ons but takes none, ADR 0082);
- the four notices of a booking in the app: `app_booking`;
- `photos-own-record-v1` and `photos-marketing-v1`, which only the profile's switch ever wrote: `app_profile`;
- `withdrawal`: `erasure`.

Left empty: `referral-consultation-v1` and `waitlist-v1` (the landing, and `/book` since ADR 0051), `whatsapp-launches-v1` (the waitlists and the profile), `whatsapp-visits-v1` (the profile, and the booking sheet since 25 September 2026) and both notices for cards (the profile and the share sheet). Production still runs Phase 1 (268eaa4, `docs/runbook.md`), whose rows are all `booking-v1`, `photo-v1`, `gate-v1` or `withdrawal`, so each of its rows gets its place. A consent the deployed Worker writes between the migration and this release's deploy has none. The table stays append-only: the migration lifts its update trigger for the backfill and puts it back, in one transaction.

**Shown.** `GET /api/clients/{id}/consents` answers each purpose's `source`, of its latest row. The console writes it in board B3's Source column: "Site", "Waitlist", "Invite", "Try-on", "Booking", "Profile", "Refer", "Technician" or "Erasure"; "Not recorded" for a row with none; and "—" for a purpose never given, as the board draws it. The board writes only "App" and "Site", so the words are placeholders for the owner (`apps/ops/src/content.ts`; ADR 0025, item 79). The notice's version leaves the console's table: the source now tells a consent given by booking from the profile's, which the notice did (ADR 0080), and the version stays in the answer. The client's data export (`GET /api/me/export`) carries each consent's source beside its notice.

### An erasure blanks a check-in's coordinates

In the erasure's one batch (ADR 0066), each check-in of the person's visits loses `lat`, `lng` and `accuracy_m`. Migration 0057 makes `lat` and `lng` nullable, swapping each in place, since `no_show_cases` points at `checkins` (migrations 0031 and 0035); nothing but the check-in's own insert names either.

**What stays, and why.** The check-in's times, its technician and visit, the address it was measured against (already blanked to its city and pincode), the radius in force, whether it passed, and the distance measured. The distance stays because it locates nobody: it is one number between two points, neither of which is kept any longer. With the radius and the pass, it is the record of whether the technician was at the door, and one of the three facts a no-show is ruled on (`src/policy/no-show.ts`), which a ruling or a dispute still reads after the client is erased.

Nothing else holds the fix: the check-in's job event keeps its time and distance, FSM is sent neither coordinate, and the log line carries the distance and the radius.

## Consequences

- Ops see where each consent was given. A consent recorded without a place reads "Not recorded" for good: the ledger is never rewritten.
- The owner approves the console's words for each place (ADR 0025, item 79).
- `technician` has no writer until the technician's app asks for a consent.
- An erased client's check-ins no longer say where the technician stood; whether the technician was within the radius still does.
- Tests: `test/node/migration-0057.test.ts` (the backfill's certain cases and the rest left empty, still append-only, the coordinates swapped and blankable, the deployed code's writes); `test/node/consent-writers.test.ts`; `test/node/policy-consents.test.ts`; each writer's place in `test/worker/consultations.test.ts`, `referrals.test.ts`, `tryon-api.test.ts`, `booking-consents.test.ts`, `client-profile.test.ts` (each of the app's screens, and none sent), `lead.test.ts` and `erasure.test.ts`; the app sending its screen in `e2e/app/profile.e2e.ts`, `booking.e2e.ts` and `refer.e2e.ts`; `test/worker/ops-clients.test.ts` and `test/worker/dpdp.test.ts` (the console's answer and the export); `test/worker/erasure.test.ts` (the coordinates blanked, the rest kept); `e2e/ops/clients.e2e.ts` (the Source column, with axe).
