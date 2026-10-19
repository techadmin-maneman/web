# 0218. Refer opens at the first consultation

- Status: accepted
- Date: 2026-10-19
- Topic: Referrals
- Amends [0048](0048-referrals.md)

## Context

Refer was a fitted client's (ADR 0048). Two reasons were given: the invite said "Had my hair system fitted", and a
lead with a visit only booked could invite their own first number from a second. On 19 October 2026 the owner asked
that referrals open after the first consultation instead of the first fit.

The invite no longer speaks of the sender's own hair: its preview says what Mane Man does, and who sent it. A
consultation done is a visit a specialist made to the client, which a number typed into a form is not.

## Decision

1. **Refer opens once a consultation is done,** or a first fit, a service visit or a replacement: `REFERS` in
   `src/domain/clients/fitted.ts`, read by `canRefer`. Before then `GET /api/refer` and the card's routes answer
   `403 not_consulted`, and the app's tab shows its empty state, saying referrals go live after the first
   consultation.
2. **The app reads `refers` on `GET /api/me`,** not the client's state, to open the invite and the tracker.
3. **A card of their own still waits for the first fit's photographs.** Until they are stored, the share sheet offers
   the Mane Man example card alone, and making a card answers `403 not_fitted`.
4. **Rewards are untouched.** A friend earns, and so does the client, once the friend is fitted.

## Consequences

- An invite the client came with still gives its visits at their own fit; the empty state names it as before.
- The tracker lists fitted friends only, as before.
