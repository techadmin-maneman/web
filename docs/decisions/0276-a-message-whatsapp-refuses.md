# 0276. A message WhatsApp refuses

- Status: accepted, on the owner's rulings of 18 November 2026
- Date: 2026-11-18
- Topic: Messages and the CRM
- Amends [0197](0197-one-inbound-port.md): the inbound port takes a refusal as well as a receipt; and
  [0104](0104-the-try-ons-look-on-whatsapp-only.md): a look WhatsApp refuses is seen in the client app, and Care told

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
   code; Care close it with how the client was told (`message_undelivered`, migration 0221's partial index). What
   offers rather than informs, which the owner keeps as marketing, is not chased: the referral thanks, the launch, the
   next visit's reminder, the waitlist's word, and the answer to a STOP.
3. **What reads a receipt says so.** The no-show evidence reads a refused reminder as "Not delivered · WhatsApp
   refused it", never as sent; the technician's job card reads it as sent and not delivered, which it is.
4. **The service texts Meta filed as marketing are rewritten as utility** under new names, without the line that read
   as a sales prompt ("Book a new time…", "welcome to Mane Man"). The owner ruled so; referral, waitlist, launch and
   next-visit texts stay marketing.
5. **A look WhatsApp refuses is seen in the client app.** The look's message already writes the client's alert, "Your
   try-on is ready", which opens Photos, where a client's try-on is shown behind their sign-in (ADR 0082). So a client
   who signs in sees it there, and Care's task is how they hear to. The look's own template stays
   `tryon_result_v1` for now: MSG91 refuses an image template whose sample it cannot fetch, and no public address
   serves one until the site's release.

## Consequences

- A refused message is known as soon as MSG91 reports it, and a person acts on it.
- The rate of refusals per kind is not yet watched; one alert per message is the task. A rate alert belongs with the
  alerts' pacing (the QA plan's batch F3).
- A template rewritten under a new name loses any words the Words page set for its old name, for ops to set again.
- The look's template is rewritten as utility once a public sample image can be given, or through MSG91's dashboard.
