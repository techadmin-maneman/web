# 0074. What each person learns when something changes for them

- Status: accepted; amended 28 September 2026 by [0092](0092-task-owners.md), under which ops close a visit left partly done without a follow-up, with a reason, and record an address a client gives them on the phone; and 29 September 2026 by [0096](0096-a-no-shows-charge-and-its-dispute.md), under which a charge costs what the booking was sold to cost a no-show, and the client disputes it in the app; and 1 October 2026 by [0099](0099-the-clients-note-in-fsm.md), under which the client's note is written to the visit's appointment in FSM
- Date: 2026-09-26
- Topic: Messages and the CRM
- Amends [0047](0047-visit-messages.md), [0048](0048-referrals.md), [0049](0049-dpdp.md), [0062](0062-leave-on-the-dispatch-board.md) and [0063](0063-the-asked-window.md); follows [0060](0060-an-invited-friend-reaches-ops-and-the-crm.md), [0067](0067-alerts-and-silent-failures.md), [0070](0070-vendor-correctness.md) and [0072](0072-ops-clients-and-queues.md)

## Context

The audit of 24 September 2026 followed each change through every surface it should reach, and found many that stopped at the first:

| Finding           | What happened                                                                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LIFE-07, BIZ-28   | A no-show read in the app as an ordinary past visit. The client was never told of it, or of ops' ruling, and the ruling moved no money either way.                                    |
| BIZ-21            | The mirror stored a no-show as a partial visit whose reason said so, and a visit left partly done made no task, though the brief says the partial reasons drive the task queue.       |
| BIZ-22            | ADR 0047 promised the technician's arrival message, and the no-show evidence reads its receipt; nothing wrote one.                                                                    |
| LIFE-14           | A cancel inside 24 hours of a credit-paid visit did not say the credit was gone, and credits never appeared in Payments.                                                              |
| LIFE-10           | Only the referrer was ever messaged: the friend whose credits had landed heard nothing, a held grant told nobody, and a rejected one reached neither.                                 |
| LIFE-13           | The referrer's tracker read the friend's name from their record, so after the friend's erasure it read "Erased · Sep 2026".                                                           |
| LIFE-11           | The CRM could not tell an invited friend from an organic booking, nor see the window a Phase 2 form booked, though ADR 0060 says marketing sees "the source, the day and the invite". |
| OPS-07            | Leave recorded over jobs already booked flagged nothing: the job sat unmarked on the Away cell, stayed on the technician's phone, and waited for nobody.                              |
| OPS-09            | A rejected number change vanished from the client's app, and its reason stayed in ops.                                                                                                |
| BIZ-23            | With self-serve booking off, production's setting, every consultation the site's form asked for read "Asked · not recorded": the pass found no lead of ours behind it.                |
| REQ-03            | Joining a waitlist sent no WhatsApp, though ADR 0041 lists the confirmation.                                                                                                          |
| REQ-04            | The brief's `POST /appointments/:id/note` did not exist; with self-serve booking on, the client's note reached neither the record nor the technician.                                 |
| LIFE-04, CLI-14   | A site booking reaches the technician with no place, and the app tells the client "We confirm it with you before your visit" with nobody to do it.                                    |
| Carried from #125 | The visit's screen said an invoice was being made while the invoice pass held it back on purpose.                                                                                     |
| Carried from #126 | Erasing a client blanked neither reason ops keep with a decision about them.                                                                                                          |

## Decision

### What the client learns

**A no-show reaches them** (LIFE-07). The visit's page says the client was not home, how long the technician waited at the door, and the ruling: being looked at, charged, or not charged (`GET /api/visits/{id}`, `no_show`). Their Payments say the same beside what the visit took. Ops' ruling queues a WhatsApp to the client (`no_show_decided`), with their consent to messages about visits, in the batch that records the ruling; it never carries ops' reason, which stays with the ruling (ADR 0072).

**A charge keeps what the visit took; what a waiver gives back waits for the owner** (BIZ-28). The prompt's rule is that "a no-show is charged under the 24-hour policy", so a charge keeps the prepayment, and the credit a credit paid with, as a cancel inside 24 hours does: nothing moves, and the record is the ruling. The prompt says nothing of a waiver. `WAIVER_GIVES_BACK` (`src/policy/no-show.ts`) stands at `false` until the owner rules: a waiver records the ruling and moves no money, the console says so beside the buttons, and the client's message asks them to message us about what they paid rather than promising anything. The code for `true` is written and tested: the credit returns to a grant that can still take it, in the ruling's batch, and the payment is refunded after it, with ops told once if Razorpay refuses. **Since 27 September 2026** the owner's ruling gives both back, and **since 28 September 2026** ops set what a waiver gives back in the console (`no_show_waiver`, ADR 0088), each ruling keeping what it gave. **Since 29 September 2026** a charge no longer keeps whatever the visit took: it costs what the booking was sold to cost a no-show, kept on the ruling, and the client can dispute it in the app, which ops refund or uphold ([0096](0096-a-no-shows-charge-and-its-dispute.md)).

**Payments carry the credits and the no-shows** (LIFE-14, LIFE-07). Board E1 draws a visit a credit covered among the payments ("Covered by credit · Rs. 0 · 1 credit used"). `GET /api/payments` now answers, beside `entries`, `credits`: every change to the ledger, newest first, each with the visit it was for, as `added` (with where from), `used`, `lost` (on a visit cancelled inside 24 hours, or a no-show ops charged), `returned`, `expired`, `withdrawn` or `corrected`. They are a list of their own rather than a third kind of entry, so each payment's own page, and ops' reading of the same entries, are as they were; the app lists the two together by date, and a credit about a visit opens that visit. A payment for a visit the client was not home for says so, is "Charged" once ops charge it, and offers the receipt alone, as a charge does.

**A held invoice says why** (carried from #125). A finished visit's detail answers `invoice_held`: `credit`, a visit credit paid for it and its invoice waits on the CA's ruling (open point 14); `checking`, a draft being checked before it is sent. The page says which, where it said the invoice was being made.

**Six messages the prompts name or imply** go in placeholder words (`src/config/message-templates.ts`; `docs/open-points.md`, item 41), each written with the change it tells of and sent by the messaging consumer, which records why it skips one:

| Message                          | Sent when                                                                                                                                          | On the consent                                                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `waitlist_confirmation` (REQ-03) | a person joins a pincode's list, once an entry; it promises word of the launch only to one who asked for it                                        | to be contacted about the request, which the waitlist's own notice asks for                                            |
| `arrival_notice` (BIZ-22)        | the first check-in that passes, once a visit (migration 0044's index); one that reaches us over ten minutes late is recorded as not sent, with why | WhatsApp about visits                                                                                                  |
| `no_show_decided` (LIFE-07)      | ops rule on a no-show                                                                                                                              | WhatsApp about visits                                                                                                  |
| `friend_credited` (LIFE-10)      | a referral's credits land, by the grant or ops' approval; it names no referrer, whose name the invite shows only with their consent                | WhatsApp about visits, which the landing's consultation line records                                                   |
| `referral_rejected` (LIFE-10)    | ops reject a held grant, to both sides, never with ops' reason                                                                                     | the friend's on WhatsApp about visits; the referrer's on none of its own, as the message of a fit (ADR 0048, ruling 3) |
| a cancel's words (LIFE-14)       | a credit-paid visit is cancelled inside 24 hours, or in time on a grant that has since gone                                                        | WhatsApp about visits, as every cancel's                                                                               |

The no-show evidence reads the delivered one of the day-before reminder and the arrival notice, else the latest, on the case and the technician's card alike.

**A referral held or refused says so** (LIFE-10). `GET /api/refer` answers `invite_credits`: `checking` while ops review the grant the client's invite made, `refused` once they reject it; the Refer screen says so beneath the credit.

**The referrer's tracker reads a friend's first name from the referral, and an erasure blanks it** (LIFE-13). The grant keeps it on the referral (`referral_attributions.friend_first_name`, migration 0044, filled for the grants already made to friends not erased), and the tracker reads it. The friend's erasure blanks it with the rest of their data, and the app writes "A friend", so the tracker no longer tells the referrer the friend asked to be erased, and no name of an erased person is kept. Whether a first name may stay in the referrer's view after the friend's erasure is counsel's to rule (`docs/open-points.md`, item 63; ADR 0049 amended); until then it goes.

**A decided change of number stays in view** (OPS-09). `GET /api/profile` answers `number_change_decided` for thirty days after ops decide, while no other change is under way: confirmed, or rejected with ops' reason, which the console now tells ops the client reads.

### What ops learn

**A no-show is recorded as one** (BIZ-21). `visits.outcome` takes `no_show` (migration 0044 rebuilds `visits`, which nothing points at, and turns the partial no-shows already stored into no-shows), and the mirror writes it from the job's own outcome event.

**Three Tasks groups, each read from the rows as the others are** (ADR 0067's pattern; `src/policy/tasks.ts`). Each takes the default two days, and ops' saved allowances are kept. A task about a visit still to come now carries the visit's start, and falls due no later than it.

| Group                           | A task while                                                                     | Waits from                                                         | Leaves when                                              |
| ------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------- |
| Job on a day off (OPS-07)       | a job is still booked on a day its technician is away                            | the leave was recorded                                             | the job is moved, or the leave taken back                |
| Address to confirm (LIFE-04)    | a visit to come has a client with no address saved                               | the visit first reached our records (`appointments.first_seen_at`) | the client saves one, in the app, whose Home asks for it |
| Visit left partly done (BIZ-21) | a visit closed partial, not a no-show, has no later visit of the client's booked | the technician closed it                                           | another visit is booked                                  |

Only the client can save an address, and nothing marks a partial visit's task done without a follow-up visit: both are the owner's to decide (`docs/open-points.md`, item 62). **Amended 28 September 2026 ([0092](0092-task-owners.md)):** the owner ruled yes to both; ops record on the client's page an address the client gives them on the phone, saved as the app's save saves one and marked as given to ops, and close a visit left partly done without a follow-up, with a required reason kept under who closed it.

**Leave over jobs already booked names them** (OPS-07). `POST /api/technicians/{id}/leave` answers the jobs still booked on those days; the Technicians panel lists them beneath the form, with the way to the dispatch board; and the board writes such a day "Away · 1 job to move" in oxblood, where a day off with nothing on it reads "Away". The job stays on the technician's phone until it is moved: taking it off would be a move by another name, and ops choose where it goes.

**The asked window of a request from the site's form** (BIZ-23; ADR 0063 amended). A consultation with no lead of ours behind it takes the window of the client's latest consultation request, which the form keeps while self-serve booking is off, also when FSM refuses to say.

### What reaches the other surfaces

**A client's note reaches the technician** (REQ-04). `POST /api/appointments/{id}/note` keeps the note on the visit (`appointments.client_note`, `client_note_at`, migration 0044), the latest in place of any before it, behind `SELF_SERVE_BOOKING` like the other `/api/appointments/*` routes; a visit already under way still takes one, and one over or cancelled does not. The technician reads it on the client's card, whose `note` slot had always been empty, from when the card opens the day before. With the switch on, the app's Add a note opens a sheet the design does not draw; offline, or with the switch off, it opens WhatsApp as before, as ADR 0043 has it. FSM is not written: no note on an appointment has been tried against the org (`docs/open-points.md`, item 64). The brief's other appointment columns (`payment_state`, `credit_ledger_id`, `address_id`) are read from the payments, the ledger and the addresses where they are needed, and are not added.

**The CRM can tell an invited friend, and the window they booked** (LIFE-11). The sync reads the invite a person came through and the window their booking asked for (the request the form left, else the slot it held), and writes them as `Lead_Source` "Referral", `Referral_Code` and `Booked_Window`. Zoho refuses a record with a pick-list value it does not have, and the org has none of the three yet, so they are written only once `CRM_ORG_HAS_REFERRAL_FIELDS` (`src/config/crm.ts`) is turned on, after `scripts/ops/setup-crm.ts` has made them. It is a code switch, not a Worker variable: the free plan's 64 are full. Until then a record the CRM already has carries the window and "Came through an invite" in its note, which needs no field (`docs/open-points.md`, item 34; runbook, section 8).

### What an erasure blanks

The reasons ops keep with a decision about the client (ADR 0072): a referral grant's review reason, whichever side of it the client was, and a no-show ruling's reason; and the client's own notes to the technician. Each in the erasure's one batch (ADR 0066), so a refused erasure blanks none of them. ADR 0049 is amended to say so.

## Consequences

- Migration 0044 rebuilds `visits` with a wider CHECK, copying every row. The Worker already deployed still writes a no-show as `partial` with the reason `no_show`, which the new CHECK takes, and the next sync of that visit makes it a no-show; in the minutes between, it shows nothing for a no-show's outcome. The migration's other changes are new columns and indexes, which the deployed Worker never reads.
- The Tasks board reads a third statement, since D1 takes at most five arms in one compound SELECT.
- The API contract gains `no_show` and `invoice_held` on a visit's detail, `no_show` on a payment and `credits` beside the payments, `invite_credits` on Refer and a nullable friend's first name in its tracker, `number_change_decided` on the profile, `jobs` in the leave's answer, three task groups and the note route; the documents and the apps' types are regenerated.
- Every word the boards do not draw is a placeholder, listed in ADR 0025's register as "The messages people are owed, and the hand-offs no board draws".
- Tests: `test/worker/messages/owed-messages.test.ts`, `client-notes.test.ts`, and additions to the erasure, asked-window, consultations, field-operations, visit-messages, referral-grants, client-profile, fsm-mirror, ops-tasks, dispatch, client-visits, client-payments, ops-no-shows, crm-sync and zoho tests; `test/node/database/migration-0044.test.ts` and `app-payments.test.ts`.
