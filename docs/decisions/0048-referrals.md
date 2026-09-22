# 0048. Referrals and the waitlist

- Status: accepted; cards, the landing page and ops' waitlist views to follow in P2-M3
- Date: 2026-09-22

## Context

P2-M3 covers:

- codes and the card;
- the landing APIs and attribution;
- the first-fit grant, fraud holds and review;
- the back-fill import and the pincode launch.

The designs are "Referral and Waitlist" (the card, the chat preview, and the landing at `maneman.in/r/:code`) and the client app's Refer tab (F1 to F6). The owner ruled the six open questions as recommended (ADR 0025, item 24). Counsel signed off the card's lines and rulings 2 and 3 (item 25).

## Decision

**Pincodes decide where we go.** `serviceable_pincodes` (migration 0021) is loaded from `data/pincodes/ncr-pincodes.csv` by `scripts/import-pincodes.ts`.

- Each pincode's area is the shortest name among its sub and head post offices, until ops give better ones.
- Staging runs with every pincode served (`--all-served-from`, open point 21).
- `GET /api/pincodes/:pin` says served or not, with the area, and refuses what is not an Indian pincode.

**A client's code** (`referral_codes`) is their initials and four random characters from an alphabet without look-alikes (no 0, O, 1 or I). It is never taken from their mobile number, and is made the first time they open Refer (`GET /api/refer`). The code also holds the card's state (house or personal) and version.

**The invite** (`GET /api/r/:code`) is valid or unknown, with the card to show.

- It names the referrer by first name only if their latest consent to photographs on referral cards was given on the notice that says so. That is `photos-referral-cards-v2`: the four lines, and "Your first name appears on your invite." (ruling 2). The app shows the same five lines.
- `REFERRER_NAME_ON_INVITE` switches the name off everywhere.
- An erased referrer's invite stays valid, with the house card (ruling 1).

**Attribution** (`referral_attributions`) happens once, to the first invite a person uses, and only while they are new: not the referrer, and not already fitted. It starts pending; the grant, holds and review arrive next.

**The landing's two actions**, each taking Turnstile and the booking form's per-number and per-address limits:

- `POST /api/r/:code/consultation` books a free consultation straight into the schedule: a hold, then the queue, as a free booking in the app.
  - The page's line "You may contact me on WhatsApp about this consultation." is recorded as consent to WhatsApp about visits, on its own notice (`referral-consultation-v1`), so the confirmation and reminder reach them (ADR 0047).
  - It answers whether the invite's credits apply.
  - While self-serve booking is off, it answers `409 ops_assisted` (open point 41).
- `POST /api/r/:code/waitlist` records the person on the pincode's list.
  - It takes their required consent to be contacted about the request (`waitlist-v1`), and the optional launch alert (consent to WhatsApp about launches).
  - The invite is held for them, valid until 12 months after the area launches (`inviteLapsed`).

**Erasure** removes a person's waitlist entries. Their code and ledger stay (ADR 0033).

**The grant** (`src/domain/referral-grants.ts`) runs on the five-minute cron (`src/scheduled/referrals.ts`), with no new trigger. It takes up to ten pending referrals a pass: those whose friend has a first fit that FSM closed as done (a visit with outcome done).

- **A lapsed invite expires.** An invite from the waitlist lapses 12 months after its area launched (ruling 1). Its friend's consultation stayed free, but carries no credits.
- **The fraud rules run first** (`fraudSignals`):
  - the two share an address (the same first line and pincode, in any address either has saved);
  - they share a UPI handle (the payments' hashed handles; no card fingerprint is given to us, ADR 0025, item 21);
  - the referrer already has 5 fits granted or held in that calendar month in India (ruling 5), so the sixth is held;
  - their mobile numbers match.
- **A grant that meets any rule is held,** with the rules it met, for ops' review.
- **The rest are granted in one batch:**
  - 3 service-visit credits each, expiring in 365 days, once per referral (ADR 0033);
  - the attribution granted;
  - the referrer's WhatsApp, "friend fitted", with the friend's first name.
- **A referrer who has been erased gets nothing,** and no message. Their friend keeps the 3 the invite promised (ruling 1).
- **The referrer's message needs no consent of its own.** Ruling 3 says the referrer is told, and counsel confirmed it. It still respects erasure, messaging being on, and staging's allowlist.

**Ops' review** is on the ops surface, behind Access:

- `GET /api/referrals/held` lists the held grants, with the rules each met.
- `POST /api/referrals/:id/decision` approves, and the credits and message follow, or rejects with a reason.
- Each decision is audited (`referral.decide`).

**Afterwards, on the same cron:**

- A grant past its expiry is closed with an expire entry, once (`expireCredits`).
- A referral whose friend's first fit was refunded in full, under the guarantee, has what is left of both sides' credits clawed back (`clawBackRefunded`).

## Consequences

- The consultation a friend books is in FSM at once, like any booking in the app.
- The landing page itself (mm-site's Worker entry, ADR 0027), the card upload, and the versioned Open Graph image arrive with the rest of P2-M3.
