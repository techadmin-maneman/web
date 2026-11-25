# 0320. A lead's stages, and a lead lost

- Status: accepted
- Date: 2026-11-25
- Topic: The ops console
- Amends [0149](0149-lost-reasons.md): the lost reasons ops keep are also why a lead was lost

## Context

The owner's launch brief of 25 November 2026 (T6) asks that each lead carry its stages, each with when it was reached
(new, first reply sent, qualified, consultation booked, consultation attended, fitted, lost), and that a lost lead
record a reason category and the client's objection, shown and edited in the console. The owner ruled the same day
that a lead is qualified when its first consultation is booked, with no separate event for Google or Meta, and that the
first reply is Care's first written one.

Most stages already happen in our tables: the person, the Care inbox's replies, the conversions recorded for a
consultation booked and done (ADR 0288), and the visits. Only "lost" is a person's call. ADR 0149 already keeps a list
of reasons a client does not go ahead after their consultation, which ops keep in Settings › Job sheet.

## Decision

1. **The stages are read, never kept.** Each is when it was first reached: a lead from when we first held the person;
   the first reply at Care's first written message to them that went, an automatic one (the after-hours reply among
   them) or one WhatsApp refused being none; qualified at their first consultation booked, one row for both; attended
   at their first consultation done; fitted at their first fit done, a consultation and fit in one visit's among them. A
   stage not reached yet reads as such.
2. **Lost is ops' call,** on the client's page: a reason from the job sheet's lost reasons, the one list ops keep for
   why a client does not go ahead (ADR 0149), and the objection in ops' words, beside the person's attribution
   (`POST /api/clients/{id}/lost`, Customer Care · Act, audited). The brief's categories (price, trust, timing, not
   suitable, no response, other) are ops' to set there. Choosing "Not lost" takes it back; a lead never lost is left as
   it is. A lead still lost keeps the day it was first lost however its reason or words change.
3. **The client's page shows them** in a Lead panel after How they found us, in the console's rows: the stages to read,
   Lost to choose, the day it was lost, and the objection to type once lost.

## Consequences

- An erasure blanks the objection; the reason stays, as a figure that names nobody. The client's data export carries
  both.
- A stage reached and then undone (a consultation booked and cancelled) keeps the day it was first reached.
- Tests: `test/worker/attribution/lead-stages.test.ts`, `test/dom/ops-attribution.test.ts`.
