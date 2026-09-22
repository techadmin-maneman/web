# 0047. Messages about a client's visits

- Status: accepted
- Date: 2026-09-22

## Context

The prompt's Phase 2 messages include "consultation confirmation, day-before reminder", and "payment receipt, reschedule and cancel confirmations". WhatsApp stays on Evolution (plan decision 1): there are no Meta-approved templates, so our texts live in `src/config/message-templates.ts`. The owner writes the final copy.

The client switches each consent in the app (ADR 0042). One of them is "WhatsApp about your visits" (`whatsapp_visits`), which is off until switched on.

The messaging pipeline already exists (ADR 0041):

- `outbound_messages` holds each message, with its kind and subject;
- the messaging queue's consumer is the only caller of the WhatsApp provider;
- the sweeper re-queues a message whose queue message was lost;
- staging sends only to its allowlist.

## Decision

**Five kinds, each about an appointment:**

| Kind                        | Sent when                                        | Says                                                                 |
| --------------------------- | ------------------------------------------------ | -------------------------------------------------------------------- |
| `consultation_confirmation` | a consultation is booked in the app              | the day and window                                                   |
| `payment_receipt`           | a paid visit is booked                           | the visit, day, window, technician, amount and reference             |
| `visit_reminder`            | from 6 pm in India the day before a booked visit | the visit, day, window and technician                                |
| `reschedule_confirmation`   | a visit moves, in place or to a new visit        | the new day, window and technician                                   |
| `cancel_confirmation`       | the client cancels                               | the visit and day, and the refund and where it goes, if there is one |

**Written with the change, sent after it.** The message's row is written with the booking, move or cancel, in the same batch where one exists. Its ID then goes to the messaging queue. If that send is lost, the sweeper re-queues the row.

**The consumer writes the text when it sends,** from the visit as it stands then (`composeVisitMessage`). It sends nothing when:

- the client has not switched on WhatsApp about visits, or has since switched it off;
- the visit is no longer booked (for anything but a cancel);
- the person was erased, messaging is off, or the number is not on staging's allowlist, as for every message.

A skipped message records why.

**Reminders ride the five-minute cron** (`queueReminders`), with no new trigger. From 6 pm in India, each pass queues up to 20 reminders for tomorrow's booked visits, one per visit.

**One consumer for every kind.** The try-on result keeps its image link and its daily cap. The visit messages are text only. Both share the claim, the retries and the failure alert.

## Consequences

- A client gets no visit messages until they switch on WhatsApp about visits in their profile. Nothing in the booking flow asks yet. Whether it should, and the final copy, are the owner's (`docs/open-points.md`, item 40).
- On staging, only numbers on the allowlist receive them.
- Ops' own messages (a visit ops moved, the technician's arrival) arrive with dispatch (P2-M4).
