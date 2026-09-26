# 0073. What each person learns when something changes for them

- Status: accepted
- Date: 2026-09-26
- Amends [0047](0047-visit-messages.md), [0048](0048-referrals.md), [0062](0062-leave-on-the-dispatch-board.md) and [0063](0063-the-asked-window.md); follows [0067](0067-alerts-and-silent-failures.md), [0070](0070-vendor-correctness.md) and [0072](0072-ops-clients-and-queues.md)

## Context

The audit of 24 September 2026 followed each change through every surface it should reach, and found many that stopped at the first:

(Filled in below as the package lands.)

## Decision

**A no-show reaches the client** (LIFE-07). A no-show read in the app as an ordinary past visit, and the client heard nothing of it or of ops' ruling. Now:

- the visit's page says the client was not home, how long the technician waited at the door, and the ruling: being looked at, charged, or not charged (`GET /api/visits/{id}`, `no_show`);
- their Payments say the same beside what the visit took (below);
- ops' ruling queues a WhatsApp to the client (`no_show_decided`), with their consent to messages about visits, in the batch that records the ruling. It never carries ops' reason, which stays with the ruling (ADR 0072).

**Payments carry the credits and the no-shows** (LIFE-14, LIFE-07). Credits never appeared in Payments, though board E1 draws a visit a credit covered among the payments ("Covered by credit · Rs. 0 · 1 credit used"). `GET /api/payments` now answers, beside `entries`, `credits`: every change to the ledger, newest first, each with the visit it was for, as `added` (with where from), `used`, `lost` (on a visit cancelled inside 24 hours, or a no-show ops charged), `returned`, `expired`, `withdrawn` or `corrected`. They are a list of their own rather than a third kind of entry, so each payment's own page, and ops' reading of the same entries, are as they were; the app lists the two together by date, and a credit about a visit opens that visit. A payment for a visit the client was not home for says so (`no_show`), is "Charged" once ops charge it, and offers the receipt alone, as a charge does.

**A charge keeps what the visit took; what a waiver gives back waits for the owner** (BIZ-28). The prompt's rule is that "a no-show is charged under the 24-hour policy", so a charge keeps the prepayment, and the credit a credit paid with, as a cancel inside 24 hours does: nothing moves, and the record is the ruling. The prompt says nothing of a waiver. `WAIVER_GIVES_BACK` (`src/policy/no-show.ts`) stands at `false` until the owner rules: a waiver records the ruling and moves no money, the console says so beside the buttons, and the client's message asks them to message us about what they paid rather than promising anything. The code for `true` is written and tested: the credit returns to a grant that can still take it, in the ruling's batch, and the payment is refunded after it, with ops told once if Razorpay refuses.

**A no-show is recorded as one** (BIZ-21). A visit the technician closed as a no-show was stored as a partial visit whose reason said so, and read as partial everywhere. `visits.outcome` now takes `no_show` (migration 0043, which rebuilds `visits`: nothing points at it), the mirror writes it from the job's own outcome event, and the rows already stored as partial no-shows became no-shows.

**Leave over jobs already booked is flagged three ways** (OPS-07). Leave moves no job (ADR 0062), and a technician's Wednesday job sat unmarked on his Away cell, stayed on his phone, and waited for nobody. Now:

- `POST /api/technicians/{id}/leave` answers the jobs still booked on those days, and the Technicians panel lists them beneath the form, with the way to the dispatch board;
- the board writes such a day "Away · 1 job to move" in oxblood, where a day off with nothing on it reads "Away";
- each job waits on the Tasks board as **Job on a day off**, from when the leave was recorded, due by the job's own start, until it is moved to someone else or the leave is taken back.

The job stays on the technician's phone until it is moved: taking it off would be a move by another name, and ops choose where it goes.

**A visit to come with no address is a task** (LIFE-04, its task part). A booking from the site asks for no address, and the app told the client "We confirm it with you before your visit" with nobody to do it. A visit still to come whose client has no address saved now waits on the Tasks board as **Address to confirm**, from when the visit first reached our records (`appointments.first_seen_at`, migration 0043, written by a booking and by the mirror's first sync), and falls due two days on or at the visit's start, whichever is sooner: every task gains the start of the visit it is about, and none falls due after it. Only the client can save an address, in the app, whose Home asks for one while something is booked (ADR 0059); the task goes when they do. Ops cannot record one the client gives them on the phone: that is logged for the owner (`docs/open-points.md`).

**A visit left partly done is a task** (BIZ-21). The prompt: "ops need the full set because these drive the task queue". A partial visit now waits on the Tasks board as **Visit left partly done**, with the technician's reason, from when he closed it, until the client has another visit booked after it to finish what was left. It takes the default two days. There is no "no follow-up needed" mark: like a replacement falling due, the task goes when the thing is done, and a client who wants no follow-up keeps it on the board until the owner says otherwise (`docs/open-points.md`, item 58).

## Consequences

- Migration 0043 rebuilds `visits` with a wider CHECK, copying every row. The Worker already deployed still writes a no-show as `partial` with the reason `no_show`, which the new CHECK takes, and the next sync of that visit makes it a no-show.
