# 0067. A failure that needs a person reaches one, once, with the IDs to act on

- Status: accepted. Amends ADR 0011 on what a refused Turnstile secret answers, and ADR 0044 on a Books refusal. Amended 4 October 2026: "Alerts on Tasks", on the owner's ruling that alerts get a home in the console; and "Told again on a clock".
- Date: 2026-09-25

## Context

The audit of 24 September 2026 found that much of what goes wrong reached nobody (findings INT-06, 07, 08, 12, 14, 15, 16, 20, 21, 22 and 24):

- **Give-ups logged and nothing more.** FSM erasure stopped after ten attempts with no word to anyone, leaving a client's details in FSM past the seven-day promise. Books refusals were logged and retried every hour for ever. A draft invoice sat for days while the client had been told "within the hour". Google refused every address search on staging, Turnstile could turn every lead away, and a booking whose FSM queue message failed never reached FSM, all without a line to ops.
- **Login codes.** A code that failed to send left one warning. Every client and technician signs in with a WhatsApp code, so a dropped bridge session would lock everyone out with nobody told.
- **Alerts that could not be acted on, or that never stopped.** "Refund N rupees by hand" named no visit or payment, and the console finds a client by mobile number only, so a second refund was a real risk. Staging's synthetic mirror rows raised an alert every night.
- **Scheduled passes that stopped at one bad record.** Anything but a 4xx threw out of the invoice and Books passes, and the oldest record, which each pass takes first, blocked the rest for good. The passes together could make more outside calls than the free plan's 50 an invocation.

## Decision

**Alerts are kept in D1, and told once** (`src/domain/alerts.ts`, migration 0038).

- An alert is raised under a key naming what went wrong and to what, such as `books_refund_refused:<refundId>`. Raising it again only counts it.
- The chat is told the first time, and again while it stays open ("Told again on a clock"). A failure expected now and then waits for its `after`-th sighting before anyone is told.
- It is resolved when what it was about is put right, by the code that sees it put right. Raised again after that, it is a new alert.
- Its message carries IDs, never a name, number or address, and a link into the ops console, such as `/clients/<personId>`, which finds the client without their mobile number. The chat post still scrubs numbers and e-mail addresses as a last defence.
- The webhook stays optional, as `ALERT_WEBHOOK_URL` always was: without it the alert is logged and kept. If D1 cannot keep it, the chat is told anyway.

Alerts that already fire once per record, and name it, still post directly: a try-on that failed, and a booking FSM would not take. A lead or erasure the CRM gave up on, a message that failed and a deletion request five days old are kept too, since 4 October ("Alerts on Tasks").

**The cron counts its failures and shares one budget of outside calls** (`src/scheduled/cron.ts`, `src/lib/call-budget.ts`).

- Each job's failed runs in a row are kept in `cron_jobs`. The third alerts, once, with the job and its error; a run that works starts the count afresh and closes the alert.
- A run has 40 outside calls to share, leaving ten of the free plan's 50 for a Zoho token refresh and the run's alerts. Each pass asks for what one record may cost before it starts on it, and stops when it is refused; what it leaves is the next run's first.

**A pass handles each record on its own.** In the invoice and Books passes a failure is logged, that record waits an hour, and the pass goes on. A refusal (a 4xx) is told at once; any other failure on its third time.

**What is told, and when:**

| What                                                                   | Told                                                                    | Closed when                                              |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------- |
| A cron job failing                                                     | on the third run in a row                                               | a run works                                              |
| Books refusing a payment, its application or a refund (amends 0044)    | at once                                                                 | it goes through                                          |
| Books failing on one in any other way                                  | on the third time                                                       | it goes through                                          |
| A payment with nothing to set it against, or kept on a cancelled visit | once (open point 16)                                                    | never: ops settle it in Books                            |
| FSM refusing to invoice a visit                                        | at once                                                                 | the invoice is issued                                    |
| A draft invoice the client cannot open                                 | an hour after the visit ended                                           | the invoice is issued                                    |
| FSM not anonymising an erased client's contact                         | when the sweeper stops asking, after ten attempts                       | never: its task goes once `fsm_erased_at` is set by hand |
| A technician's step not in FSM                                         | an hour after it landed                                                 | it is written or given up                                |
| Login codes failing                                                    | on the third in an hour                                                 | a code goes through                                      |
| The WhatsApp bridge closed                                             | on the second reading in a row, read every five minutes                 | it is open                                               |
| Google refusing the address search                                     | at once                                                                 | Google answers a search                                  |
| Turnstile unable to check visitors                                     | on the fifth in an hour                                                 | Turnstile answers again                                  |
| A cancelled visit's refund failing                                     | at once, naming the visit and the Razorpay payment                      | never: ops refund by hand, once                          |
| FSM sync giving up on an appointment                                   | at once, then counted as the reconciliation queues it night after night | it syncs                                                 |
| AILabTools credits below the floor                                     | once, not every hour                                                    | a top-up lifts them over the floor                       |

**Two groups join the Tasks board**, read from the rows as the others are: a finished visit whose invoice is still a draft (Draft invoice), and an erased client whose FSM contact the sweeper gave up on (Erasure left in FSM). Board D2 draws neither (ADR 0025, item 39). A task allowance ops saved before a group was added keeps its figures, and the new group takes its committed one.

**Smaller changes.**

- A text to the WhatsApp bridge has 20 s, not the 60 s a media send needs, so a login code sent after the response ends with a log line inside the 30 s the runtime allows.
- The cron reads the bridge's connection state, `GET /instance/connectionState/{instance}`, the runbook's own first check. It is read only.
- The Geocoding API refuses under an HTTP 200, with `REQUEST_DENIED`, `OVER_DAILY_LIMIT` or `OVER_QUERY_LIMIT`; these are now refusals, with Google's message kept, and the stub answers as Google does.
- Turnstile's `internal-error`, and our own secret refused (`invalid-input-secret`, `missing-input-secret`), now answer `503 unavailable` rather than `403 turnstile_failed`: no visitor could pass, so it is not the visitor at fault. ADR 0011's rule that Turnstile fails closed stands.
- FSM answering an appointment ID it cannot parse with `404 INVALID_URL_PATTERN` reads as the appointment gone, as a 204 already did.
- A booking from the site is stamped once it is on the fsm-sync queue (`leads.fsm_queued_at`). The sweeper sends one left unstamped after two minutes, once; one over a day old is left to ops, so switching FSM on sends no backlog.

## Alerts on Tasks (4 October 2026)

The 2 October audit found that failures needing a person still lived only in the chat (PLAT-40, OIA-06, PS-20). The owner ruled that rejected work and open alerts belong on Tasks, with "Send again".

- **"Needs a hand"** heads Tasks: every open alert ops have been told of (`alerts.told_at`: the first sighting, or the `after`-th for one that waits), the longest open first, with its message and its link (`GET /api/alerts`).
- **Each department sees its own kinds** (`src/policy/alerts.ts`): a failed message, a CRM give-up or a deletion request is Customer Care's; refunds, invoices and Books are Finance's; stock, technicians and bookings are Operations'. Anything else, about the system itself, is Admin's.
- **Mark done** (`POST /api/alerts/{id}/resolve`, Act, audited) closes one ops have put right by hand, which the runbook's SQL did before. For a CRM erasure it also records the person as erased there, so it asks Manage, as every erasure does.
- **Send again** (`POST /api/alerts/{id}/send-again`, Act, audited) puts a failed message, a lead the CRM gave up on, or a CRM erasure back on its queue with its tries counted afresh, and closes the alert. If it fails again, that is a new alert, told again.
- **Kept now, not only posted:** a lead the CRM gave up on (`crm_lead`), an erasure there (`crm_erasure`) and a failed message (`message_failed`), each closed when it goes through; and a deletion request five days old (`deletion_waiting`), one alert per request, closed when it is decided. The request is marked alerted only once its alert is kept, and the message says "within 7 days" and the day it is due.

What the audit asked of FSM here (a Tasks group for a technician's close FSM refused, "Try again" through FSM, and the phone's and the dispatch board's words for it) is not built: FSM is being removed, and without it a technician's steps land in our own database.

## Told again on a clock (4 October 2026)

The 2 October audit found that telling the chat only at 10, 100 and 1,000 sightings goes quiet in a long outage: the bridge check, every five minutes, posted at about 10 minutes, 1.6 hours and 16.6 hours, then nothing for days (PLAT-41). It also found open alerts whose subject was gone.

- **An open alert is told again** at its first sighting once it has gone 24 hours untold, or 6 hours for the WhatsApp bridge, failing login codes, a paid booking with no visit, and a refund that failed (`retellAfterHours`, `src/policy/alerts.ts`). The 10, 100 and 1,000 counts still tell it too. Either reads "Still open since Mon 21 Sep, 12 pm, 37 times: …". `alerts.last_told_at` (migration 0088) holds when it was last told; one sighting tells it, however many come together.
- **Google's refusal and Turnstile's outage** are one alert each, no longer one a day, and close at the next search Google answers or the next visitor Turnstile checks.
- Migration 0088 closed what was open with nothing left to put right: the dated Google and Turnstile alerts, invoice alerts of visits FSM had deleted, and technicians' steps no longer waiting for FSM. Nothing raises these two kinds once FSM is off, so no code closes them.

## Consequences

- A failure that needs a person is in the `alerts` table, open until it is put right, and on Tasks once ops have been told of it.
- A resolved alert stays in the table, and so does one nothing closes (the table's "never" rows), so "open" means not yet known to be put right. The table grows by the alerts raised, which is small; nothing deletes them yet.
- Checking whether to close an alert costs one indexed D1 statement where the good outcome happens: a login code sent, an appointment synced, a job step written, a Books record gone through. Each reads the open alert by key through a partial index and usually writes nothing.
- A refused Books refund is still asked again every hour, as a refusal can be put right in Books. Ops now know of it at once, and again each day it stays refused.
- **Still open:** how a kept charge is invoiced waits for the CA (open point 16), and whether Books may keep an erased client's display name waits for counsel (open point 23).
