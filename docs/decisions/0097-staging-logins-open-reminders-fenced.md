# 0097. Staging logins open, reminders fenced

- Status: accepted
- Date: 2026-09-30
- Amends [0030](0030-one-time-codes.md), whose login codes checked staging's allowlist; [0047](0047-visit-messages.md), four of whose five kinds no longer do; and [0070](0070-vendor-correctness.md), whose try-on gate promised a WhatsApp copy only where the allowlist let one go. Follows [0009](0009-stay-inside-cloudflare-free-tier.md), [0041](0041-outbound-messages-for-phase-2.md), [0048](0048-referrals.md) and [0086](0086-the-next-visit-is-offered.md), whose message kinds this record classifies; records [0025](0025-phase-2-conflicts-register.md) item 84 and the owner's ruling of 30 September 2026.

## Context

`MESSAGING_ALLOWLIST` is a staging secret holding the founders' numbers; `onAllowlist` (`src/config/settings.ts`) refuses every message to any other number, so that the roughly 54 test numbers already in staging's database, some possibly strangers' own, are never messaged by mistake.

That refusal held back login codes too. A colleague trying staging on their own phone had their code request answer `202`, same as ever, and then nothing arrived: their number was not a founder's, so the code never left the Worker. The only way to test the app at all was to borrow a founder's phone.

The owner was asked whether to remove the allowlist outright, and chose not to: **"Logins open, reminders fenced."** A message that answers the person who just acted may go anywhere; a message nobody just asked for stays fenced to the handsets we know are safe to message.

## Decision

### Every login code answers the phone holding it

A code is always asked for by the number it is sent to: a client's `POST /api/auth/otp`, a technician's `POST /api/tech/auth/otp`, and each side of `POST /api/number-change` (the old number and the new) all send through the same two functions, `countCode` and `sendCodeAfterResponse` (`src/http/send-code.ts`), which no longer call `onAllowlist`. Every other rule is unchanged: the per-number and per-address limits, the daily ceiling that only a sent code spends, the rule that a code goes only to a number an account holds, and the client and technician login rules of `src/policy/one-time-code.ts`.

### Fifteen kinds of queued message, classified once

`src/queues/messaging.ts` sends every WhatsApp message but a login code (ADR 0030). Each of the fifteen kinds `MESSAGE_KINDS` names (`src/config/message-kinds.ts`) is now one of two classes, in `MESSAGE_CLASSES` beside the templates (`src/config/message-templates.ts`):

| Class         | Meaning                                                               | Kinds                                                                                                                                                                                                               |
| ------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Answering** | Sent because the same person just acted on staging's own screens      | `tryon_result`, `consultation_confirmation`, `payment_receipt`, `reschedule_confirmation`, `cancel_confirmation`, `waitlist_confirmation`                                                                           |
| **Automatic** | A scheduled job, or a message to someone other than the one who acted | `visit_reminder`, `visit_moved`, `arrival_notice`, `no_show_decided`, `no_show_dispute_ruled`, `booking_refunded`, `next_service_reminder`, `friend_fitted`, `friend_credited`, `referral_rejected`, `launch_alert` |

`sendMessage` checks `onAllowlist` only for an automatic kind (`heldBackByAllowlist`); an answering kind reaches any number once messaging is on and the person is not erased. The try-on claim's own promise of a WhatsApp copy (`promisesCopy`, `src/routes/public/tryon-claim.ts`) follows the same table, since the one kind it can queue, `tryon_result`, answers the person who just claimed it.

**The table is closed and total.** `MESSAGE_CLASSES` is typed `Record<MessageKind, MessageClass>`, so a kind added to `MESSAGE_KINDS` with no line here fails to typecheck; `test/node/api/message-templates.test.ts` also checks every kind is covered, for a reader who only runs the tests. Where a kind's class was not obvious — `reschedule_confirmation` and `visit_moved` render the same template, `visit_moved_v1`, but the first is the client's own move and the second is ops' on the dispatch board — the safer class was taken; a kind added later whose own action is unclear takes automatic, not answering (`messageClass` defaults an unrecognised kind the same way).

### Production is unchanged

Production's `MESSAGING_ALLOWLIST` is empty, so `onAllowlist` already returns true for every number there; nothing about the fence changes anything in production. The startup guard that refuses to run with messaging on and no staging allowlist (`docs/decisions/0003-environment-identity-guard.md`) stays: the automatic kinds still need it.

### A record one of our own scripts made stays fenced regardless

Refined the same day, once a review found the gap ADR 0025's register (item 84) records: our own scripts invent a client, and on the technician app's proof a technician too, each with a random `9xxxxxxxxx` number that is very likely a real person's, since India publishes no reserved test range for mobiles. Opening logins and answering messages to any number would have reached one of these strangers.

**`isStagingTestRecord`** (`src/policy/staging-test-records.ts`) names a person or technician whose name is "Staging test" or "Load test", or either followed by a word — the mark every one of our scripts already writes on its invented records. A message about one of these, or a login code to one, is held to the allowlist whatever its class: `heldBackByAllowlist` in `src/queues/messaging.ts` checks it beside the kind, `countCode` and `sendCodeAfterResponse` in `src/http/send-code.ts` check it directly, and the try-on claim's `promisesCopy` checks it against the claim's own `name` field.

`scripts/staging/seed-technician-tester.ts`'s technician is the one deliberate exception: its number is never invented, always given by whoever is testing, on their own phone, so it keeps a name outside the mark ("Test Technician") and reaches any number, exactly as this ruling intends. Fixed to fit the rule: `e2e/tech-staging/seed.ts`'s invented technician, named "Staging Technician", becomes "Staging test technician"; `scripts/staging/staging-lead.ts` and the tech-staging proof's invented client now prefer `STAGING_TEST_MOBILE` when it is set, as `scripts/staging/staging-tryon.ts` already did, and fall back to a random number regardless — the mark, not the number, is what keeps it silent. The load test (`scripts/staging/load-test-leads.ts`) runs with `SELF_SERVE_BOOKING` false, under which `bookConsultation` (`src/domain/public-booking.ts`) only writes a `consultation_requests` row and queues no message at all, so its random numbers were never at risk either way.

## Consequences

- **ADR 0030**'s "codes go only to the allowlisted handsets" no longer holds; `docs/decisions/0030-one-time-codes.md` is corrected in place, and its 25 September amendment's "one the staging allowlist holds back, cost it nothing" no longer applies to a login code, which now always costs the ceiling once it is not for an unknown number.
- **ADR 0047**'s table said four of its five kinds skipped "the number is not on staging's allowlist, as for every message"; only `visit_reminder` still does.
- **ADR 0070**'s "the try-on gate promises a WhatsApp copy only where the allowlist lets one go" no longer holds; it promises one whenever messaging is on.
- **`docs/runbook.md`**'s `MESSAGING_ALLOWLIST` row says what it now holds back.
- **`docs/technician-test-setup.md`** and **`docs/tech-field-test.md`** no longer ask that a technician's number be on the allowlist before a code will arrive; a login code reaches any phone now.
- **Nothing about who a message is about changes.** The referrer's "friend fitted" still needs no consent of its own (ADR 0048) and still respects erasure, messaging being on, and the allowlist; only the reason it is fenced — a message to someone other than the one who acted — is now named in one place.
- **No real client or technician is ever named "Staging test" or "Load test",** so `isStagingTestRecord` never holds back a real person's message; only our own scripts' invented records do, and only because they say so themselves.
- Tests: `test/worker/app/client-auth.test.ts` (a code sent off the allowlist, and held back for a "Staging test" record), `test/worker/field/tech-auth.test.ts` and `test/worker/app/client-profile.test.ts` (the same for a technician and a number change), `test/worker/messages/visit-messages.test.ts` (an answering kind sent and an automatic kind held back off the allowlist, a "Staging test" record held back regardless, and all sent with no allowlist), `test/worker/site/tryon-api.test.ts` (the claim's own promise, and its "Staging test" exception), `test/worker/site/consultations.test.ts` (the load test's booking queues no message while self-serve is off), `test/node/api/message-templates.test.ts` (the table covers every kind), `test/node/policy/policy-staging-test-records.test.ts` (the rule's own words).

## What this does not do

- **It does not remove the allowlist.** An automatic message is exactly as fenced as before; only which messages count as automatic is now written down.
- **It does not change what a message says, or who receives it.** The referrer, not the friend, still gets "friend fitted"; a cancelled visit's client still gets its own confirmation. Only the rule for _whether staging holds it back_ changes.
