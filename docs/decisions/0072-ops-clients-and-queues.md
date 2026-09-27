# 0072. The ops console's clients and queues

- Status: accepted
- Date: 2026-09-26
- Amends [0031](0031-access-and-audit.md) (one photograph view, one entry) and [0061](0061-ops-editable-inputs.md) (the task allowances' ceiling); follows [0049](0049-dpdp.md), [0067](0067-alerts-and-silent-failures.md) and [0069](0069-dispatch-under-concurrency.md)

## Context

The audit of 24 September 2026 worked the console's client page and its queues the way ops would on a busy day, and found each queue sound on its own terms and nobody able to run a day from them:

| Finding           | What happened                                                                                                                                                                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OPS-04            | The client's page showed a name, a status and the credits of a record that carried the mobile, the address, the access notes, every visit and every payment. A client was found only by typing their whole number exactly.                                  |
| OPS-05            | Nothing on the queues led to the client or to where a task is decided: held-grant names were plain text, a no-show task linked nowhere, and a referral review linked to the referrer's page, where nothing can be decided.                                  |
| OPS-03            | A no-show case named no client, lettered the phone's check-in as fact, wrote the configured wait as "Waited", hid the booked window (one check-in was five hours late), dated no receipt, and said "Never delivered" of a reminder that was never sent.     |
| FEO-11, REQ-S9-03 | Charging a no-show was one click with no reason. Both referral decisions asked for a reason in the browser only, so credits could be approved with none; three screens said the reason was "kept in the audit log", where the entry held only the decision. |
| OPS-08            | The same request had two deadlines: an erasure was due in two days on the Tasks board and in seven on Deletion requests; a grievance, promised an answer within thirty days, was on no board; a number change showed no age.                                |
| FEO-07            | The Tasks board read at most 200 tasks across every group, so a busy queue's count was cut, and said nothing of it.                                                                                                                                         |
| OPS-16            | The review queue wrote the day of the first fit where board C1 writes how long a grant has been held.                                                                                                                                                       |
| OPS-17            | Opening a client's photographs wrote an entry for every image, ten for one visit and ten again on every return to the tab; the time lettered was the browser's; and the locked state promises a log "visible to the city head" that no screen showed.       |
| OPS-11            | The Technicians roster drew each technician's phones and leave beneath his row, some 270 px each (34,000 px at 168), and every phone whose browser gave no label read "A phone".                                                                            |
| FEO-13, FEO-16    | A decision that removed its row dropped the keyboard to the top of the page; the reason fields opened without it. The referrers were read all at once with a subquery a figure, the waitlist whole, and every photograph of every visit on opening.         |
| BIZ-15            | The credit ledger's hand adjustment (ADR 0068) had no form.                                                                                                                                                                                                 |

## Decision

**Every ruling that charges, grants or refuses a client carries its reason, on the server.** `src/policy/decision-reasons.ts` says which: both referral decisions, charging and waiving a no-show, and rejecting a number change or an erasure. The routes refuse such a decision without one (`400 invalid_request`, `fields: ["reason"]`); the console asks for it before it offers the button. A no-show's reason is kept in the new `no_show_cases.decision_reason` (migration 0042), beside `decided_by`, as a grant's `review_reason` already was.

**The reason is kept with the decision, not in the audit log.** The work package asked for reasons in the audit detail. They are not put there: the log holds IDs, counts and codes only, it is append-only in the database, and it is the one record an erasure cannot reach (ADR 0031). A reason is ops' own words about a client, and "same flat as Rohit" is a personal detail. The entry names the decision, which holds the reason and who gave it; the console's hint now says "Kept with the decision, under your name", which is true.

**A no-show case is evidence, and says so whole.** `GET /api/no-shows` names the client (`person`, null once erased), says what became of the reminder (`message_state`: delivered, sent with no receipt, not sent for want of consent, not sent, or never queued), when the case opened and when it falls due. The console writes the booked window, the check-in with how far it was from the booked start, what the phone itself said where the bounds would not take it (ADR 0065), when it reached us, a dated receipt, and the wait from check-in to close, with how long it had been with us when that differs. Charging is asked about once more before it is sent; waiving is not, since it takes nothing from the client.

**One deadline per queue, the Tasks board's.** Each queue's route answers every row's `due`, counted from the moment the Tasks board counts it from and with the allowance ops set (ADR 0061), so the two can never disagree. The default allowances stay two days, but for three things already promised:

| Group             | Allowance | Why                                                                                 |
| ----------------- | --------- | ----------------------------------------------------------------------------------- |
| Call about a move | 4 hours   | A client who does not know his visit moved will not be home for it (ADR 0069)       |
| Erasure request   | 7 days    | "The 7 days run from the client's request to ops' decision" (ADR 0049)              |
| Grievance         | 30 days   | The app promises an answer "within 30 days at the latest" (docs/open-points.md, 51) |

Grievances are a Tasks group of their own. A number change waits from the second code entered, as it always did on the Tasks board, and its section now says how long it has left. The allowances' ceiling rises from 336 to 720 hours so the thirty days can stand; a group added since ops saved their allowances takes its committed figure, and theirs are kept (ADR 0067).

**The Tasks board counts whole and lists the longest waits.** Each group's count is its whole queue; it lists fifty (`TASKS_SHOWN`) and says so when there are more. One look reads at most 2,000 rows a statement (`READ_CAP`), far past any real day, and says `truncated` when it reaches that. Each task leads to the client's page, on the tab it is about, and to its own row in the section that decides it (`/no-shows#case-…`, `/referrals#held-…` and so on), which that section scrolls to and focuses.

**One opening of a client's photographs is one entry.** `POST /api/clients/:id/photos/view` writes a `photo.view` entry naming the member of staff and the client, before any image is served, and answers the time it logged by our clock and who opened them before. The images of that opening are then served for thirty minutes (`PHOTO_VIEW_MINUTES`) without another entry; an image asked for outside an opening logs one first, so none is ever shown unlogged. The console holds the opening for as long as the client's page is open, so a change of tab is not a second look, and fetches the newest two visits' photographs first and earlier ones on request. The earlier openings are listed beside the photographs: that is the log the locked state promises the city head. Whether the client is shown it on request, the board's own open question, is the owner's (docs/open-points.md, item 68).

**The client's page carries what the record holds.** Board B1's WhatsApp button stands beside the name, as drawn, and the head adds the mobile as a number to call; the content security policy never stood in the way of either (`form-action 'self'` governs forms only). Visits and Payments are tabs, in the board's order, drawn from the record already read: the address and access notes over the visits to come and done, and the payments and refunds over the credit form, which sends POST /api/clients/:id/credits (a change of -12 to 12 visits, never nought, with `correction` or `goodwill`) and shows the balance it answers. `POST /api/clients/find` finds clients by any part of a name, or four digits or more of a number typed any of the usual ways, in the request body; it lists twenty and says when more match.

**The roster is the board's rows.** One 34 px row a technician, in board D3's columns, with Leave where the board draws Skill (away today, or when the next leave begins). The name opens a modal panel with the phones and the leave; each phone is named by its browser and the last four characters of its own ID, so two alike can be told apart. The roster reads every phone in one query. An average that runs over is in the board's oxblood, and the panel's labels in its small capitals.

**Long lists come a page at a time.** The referrers fifty at a time, busiest first, counted once per code; the waitlist its two hundred longest-waiting pincodes, saying when there are more.

**The keyboard stays with the work.** A reason field takes the keyboard as it opens; called off, it gives it back to the button that asked; a decision that removes its row gives it to the queue's heading.

## Consequences

- Migration 0042 adds `no_show_cases.decision_reason`, nullable. The Worker already deployed never reads it.
- An ops tab loaded before this deploy sends a no-show ruling without a reason and is refused until it is reloaded, as intended.
- The `photo.view` entries written from now name the client (`subject_kind` `person`), where the earlier ones named each photograph and carried the client in their detail.
- The API contract gains `due` on every queue, `held_since` on a held grant, `person`, `message_state` and `opened_at` on a no-show case, `truncated` on the Tasks board, `more` on the referrers and the waitlist, and the two new routes; the documents and the apps' types are regenerated.
- Every word the boards do not draw is a placeholder in `apps/ops/src/content.ts`, for the owner with the rest of the console's copy (`docs/open-points.md`, item 42); the departures from the boards are the register's "The console's clients and queues" (ADR 0025).
- Tests: `test/worker/ops-no-shows.test.ts`, `ops-queues.test.ts`, `ops-tasks.test.ts`, `ops-clients.test.ts`, `referral-grants.test.ts`, `referral-cards.test.ts` and `test/node/policy-decision-reasons.test.ts`; the ops browser tests cover each screen.
