# 0276. A message WhatsApp refuses

- Status: accepted, on the owner's rulings of 18 November 2026
- Date: 2026-11-18
- Topic: Messages and the CRM
- Amends [0197](0197-one-inbound-port.md), [0104](0104-the-try-ons-look-on-whatsapp-only.md)

## Context

The QA run's render check of 18 November sent 44 templates to the owner's phone from the business number, 30 seconds
apart. Meta delivered 22 and refused 22 with 131049, "not delivered to maintain healthy ecosystem engagement": its cap
on the marketing messages one person receives. Meta had filed those 22 as marketing whatever we submitted them as, and
among them were the cancel's confirmation, the refund's, a paid booking that did not go through, the no-show rulings,
the aftercare guide and the credits running out. A real try-on that morning was sent, and the look never arrived.

MSG91 told us each time: its webhook reports `failed`, with WhatsApp's code at the head of `reason`
("131049: This message was not delivered…"). The hook kept only delivered and read reports, so every refused
message stayed `sent`: no alert, no task, nothing on the client's record. The technician's job card and the no-show
evidence read a refused reminder as sent, so ops could rule a no-show charge against a client whose reminder never
arrived.

## Decision

1. **A refusal is recorded.** MSG91's `failed` report for a message we sent marks it `failed`, with `refused` and
   WhatsApp's code in `last_error` (`refused 131049`). Only a message still `sent` and not delivered is marked, so a
   repeated report, or one after a receipt, changes nothing (`src/domain/messages/inbound.ts`,
   `src/policy/message-refusals.ts`).
2. **Care tell the client another way.** A refused message about the client's visit, money or look is a task on the
   Tasks board, "Message not delivered", for Customer Care within the day, with the message's kind and WhatsApp's
   code; Care close it with how the client was told (`message_undelivered`, `src/domain/care/undelivered-messages.ts`,
   migration 0221's partial index). Not chased:
   - what offers rather than informs, which stays marketing: the referral thanks, the launch, the next visit's
     reminder, the waitlist's word; and the answer to a STOP;
   - a move's word, `visit_moved` and `move_proposed`, which Operations already chase as a move the client has not
     heard of, or not answered, so one refusal is one task in one team;
   - a word for the moment, the technician arriving or on the way, which is no use by the time Care could act.
3. **What reads a receipt says so.** The no-show evidence reads a refused reminder as "Not delivered · WhatsApp
   refused it", never as sent; the technician's job card reads it as sent and not delivered, which it is; the client's
   Care thread lists it, marked "not delivered".
4. **Care's words outlive the two-year sweep only as long as the client.** A message a closed task names is kept past
   the two years sent messages are, as a no-show's and a move's are, so erasing the client still finds the task and
   blanks why Care closed it.
5. **The service texts Meta filed as marketing are rewritten as utility** under new names, without the line that read
   as a sales prompt ("Book a new time…", "welcome to Mane Man", "today", which a message sent a day late gets
   wrong). The owner ruled so; referral, waitlist, launch and next-visit texts stay marketing.
6. **A look WhatsApp refuses is shown once in the client app after sign-in**, as the owner ruled. Home names it
   (`look_to_show`) while it is held and not yet shown; the app then opens Photos, where a client's try-on is shown
   behind their sign-in (ADR 0082), and says so (`POST /api/photos/try-on/{id}/shown`, `tryon_jobs.look_shown_at`),
   so it happens once. The look's alert, "Your try-on is ready", stays in the inbox as for every look.
7. **The look's own template stays `tryon_result_v1`** for now: MSG91 refuses an image template whose sample image it
   cannot fetch, and no public address of ours serves one until the site's release. It is resubmitted as utility then,
   or through MSG91's dashboard with the sample uploaded there.

## Consequences

- A refused message is known as soon as MSG91 reports it, and a person acts on it.
- The rate of refusals per kind is not yet watched; one task per message is the alert. A rate alert belongs with the
  alerts' pacing (the QA plan's batch F3).
- A template rewritten under a new name loses any words the Words page set for its old name, for ops to set again.
- Until the look's template is utility, a client over Meta's marketing cap gets their look in the app, not on
  WhatsApp.
