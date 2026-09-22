# 0025. Phase 2: the conflicts register

- Status: accepted, and kept up to date. Items marked **open** need a ruling before the milestone named.
- Date: 2026-09-22

## Context

The Phase 2 prompts (`docs/prompts/phase2-*.md`) and designs (`design/phase2/`) arrived on 22 September 2026, with Phase 1 complete on staging. Read together with Phase 1 and the platform, they disagree in places. This register lists each disagreement once, with the owner's ruling or the milestone that needs one. An item that needs more than a line gets its own ADR, named here.

## The owner's rulings, 22 September 2026

1. **WhatsApp stays on Evolution API.** The prompts ask for an official BSP, with approved authentication and message templates and a BSP delivery webhook. Instead, login codes and every Phase 2 message go through the Evolution adapter (ADR 0016). The texts live in `src/config/message-templates.ts`, approved by the owner. Delivery receipts come from Evolution's `MESSAGES_UPDATE` webhook. The ban risk ADR 0016 records applies to login codes too, so the SMS fallback matters more.
2. **Cloudflare only, on the free plan.** ADR 0009 stands for Phase 2, and Supabase was considered and declined. The storage consequence is in item 10.
3. **Staging hostnames** are `app-staging.maneman.in`, `ops-staging.maneman.in` and `tech-staging.maneman.in`, one level deep. The free Universal SSL certificate covers only `*.maneman.in`, so `app.staging.maneman.in` would need the paid Advanced Certificate Manager.
4. **Where Phase 1 and Phase 2 disagree, Phase 2 wins:**
   - prepayment at booking;
   - an evening window of 4–8 pm, not 6–9 pm;
   - "consultation", not "measurement".

   The Phase 1 site and API change to match; that is a departure from the front-end prompt's "no change to the Phase 1 site beyond `/r/:code`". The payment copy on the site and in the terms ("paid on the day of the fit", "no deposit", "cancel at no charge") stays until self-serve payment is live at P2-M5, so that it is true on every day it is shown.

## The prompts against the platform

5. **Uploads through the API, not presigned R2.** The front-end prompt's technician CSP allows "the presigned R2 upload host". ADR 0014 replaced presigned links, which can be replayed until they expire and bill each replay. Photographs and cards go through `mm-api` on the page's own origin, and each is written once.
6. **`/r/:code` needs a Worker.** Its Open Graph tags change with each code and each card version, so no static build can serve them, and `mm-site` is assets-only (ADR 0021). A small Worker entry for `/r/*` in `mm-site`, with a service binding to `mm-api`, is recorded in its own ADR.
7. **The Open Graph card is a JPEG.** WhatsApp previews a card of at most about 300 KB, so the card is a JPEG, not the `.png` the prompt names. A card already shared stays cached in chats after a revoke; the versioned URL only changes new shares.
8. **Invoices are not copied to R2.** The prompt caches Books PDFs in `mm-{env}-client-docs` for 8 years. Books already keeps them, and R2 is the binding free-plan limit (item 10). Documents stream from Books when opened.
9. **No Durable Objects.** The clash check and the slot holds are atomic D1 statements over a `slot_claims` table, one row per technician, date and half-slot, written in one batch.
10. **R2's free 10 GB is a runway, not a home.**
    - Client photographs have no lifecycle rule, at 10 a visit, and Phase 1's try-on is budgeted at 79.6% of the allowance (ADR 0015).
    - The Phase 2 budget (its own ADR) makes room: try-on results are kept 14 days instead of 30, and photographs are re-encoded on the phone to about 250 KB each.
    - Past the cap, uploads are refused and stay queued on the phone.
    - The runway is roughly 2,000 visits. **Open, before the storage meter's 80% alert:** move to the paid plan, or move photographs into FSM.
11. **Free-plan CPU and subrequests.**
    - FSM webhooks are treated as hints and FSM is read again from the queue.
    - Reconciliation runs one page per 5-minute tick.
    - The technician outbox sends at most 10 events per request.
    - No new cron is added; the account allows five.
12. **Bot Fight Mode** (ADR 0023, 2) challenges automated traffic across the zone and cannot be skipped per path on the free plan, so Razorpay, FSM and Evolution webhooks may be challenged. That adds to the case for turning it off. **Open, before P2-M2.**

## Phase 1 against Phase 2

13. **Prices.**
    - The Phase 2 designs price a standard base at Rs. 30,000 ex-GST (Rs. 35,400 at 18%) and a service visit at Rs. 2,000. The Phase 1 site, its FAQ and its terms say ₹25,000 and ₹1,500, without saying whether GST is included.
    - The landing page's "matching the site" is therefore false today.
    - Prices come from the price book; the Phase 1 site takes them from it once it exists.
    - **Open, before P2-M2:** the price book itself.
14. **Service area.** Phase 1 serves five NCR cities; the Phase 2 designs say Gurgaon only. Cities are derived from the pincode table in P2-M3. **Open, before P2-M3.**
15. **Visit windows.** Phase 1 asks for one of four first-choice windows (weekday or weekend, morning or evening) and proposes "before noon" or "after six". Phase 2 offers morning 9–12, afternoon 12–4 and evening 4–8, and the dispatch board has four slots a day. The window-to-slot map is ruled on before P2-M4.
16. **Login eligibility before the mirror.** P2-M1's login needs "a booked consultation", but the FSM mirror arrives in P2-M2. Until then, eligibility comes from Phase 1 bookings that have a proposed visit date.

## The prompts and designs, where they are silent or disagree

17. **Ops boards D1, D2 and D3.** The Ops Console draws payments and a dispute (D1), tasks (D2) and technicians (D3). The design README says to build every section, and neither prompt covers them. D1 is the no-show and late-cancellation dispute queue the front-end prompt implies; D2 is the queue that partial outcomes feed; D3 is the roster, which carries device revocation. They are built in P2-F4, with their backend in P2-M4.
18. **Six technician steps.** The steps are before photographs, checklist, consumables, piece, after photographs and outcome. Board B3 draws steps 3 and 4 together, and the outcome is labelled "Step 6".
19. **Service visit length.** The Client App shows 90 minutes (B1) and the Referral landing "An hour" (C5). **Open, before P2-M4.**
20. **"Number not recognised" (A3)** tells anyone whether a number belongs to a Mane Man client. A neutral line ("if this number has a booking, a code is on its way") would not. **Ruled 22 September 2026: neutral.** The login answers every number alike (ADR 0030), departing from the prompt's `404 not_recognised`.
21. **The card fingerprint.** The fraud rules name a UPI handle or card fingerprint. **Researched 22 September 2026:**
    - Razorpay's card entity has no fingerprint, only the last four digits, network and issuer (https://razorpay.com/docs/api/payments/fetch-card-details-payment/).
    - Its Card Fingerprints API works only on saved or tokenised cards, and only after support switches it on (https://razorpay.com/docs/api/payments/cards/fingerprints/).
    - The UPI handle is returned (`vpa`).

    So the rules use the UPI handle, the address and the mobile number, as foreseen. Whether `card_id` stays the same when one card pays twice is checked in test mode at P2-M2.

22. **Weekend capacity.** The Ops Console notes weekends at 92% against 64% on weekdays. That needs weekend headcount, not software; recorded, not built.
23. **The profile's address.** Board G1 shows the area only ("Sector 65, Gurgaon 122018"), but the profile holds the house too. **Ruled 22 September 2026: the profile shows the whole address.**
24. **Referral rules the designs left open.** **Ruled 22 September 2026**, as recommended in `docs/phase2-inputs.md` (section 8):
    - **Invite validity.** An invite to an unserved area stays valid for 12 months after that area launches. If the referrer deletes their account before the friend is fitted, the friend keeps the 3 credits the invite promised. The referrer's 3 lapse, and the invite shows the house card instead of theirs.
    - **Naming the referrer.** The invite shows the referrer's first name only, and only after they have read "your first name appears on your invite" beside the card's consent lines. `REFERRER_NAME_ON_INVITE` can switch this off everywhere.
    - **What the referrer is told.** The landing page tells the friend that the referrer is told, by the friend's first name, when the friend is fitted. Booking through the invite is the friend's agreement. A friend who would rather not be named books on the public site, without credits. Counsel confirms this with the consents.
    - **Prices on the referral page.** The same figures as the site, from the price book, with no referral price.
    - **The monthly cap.** `REFERRAL_MONTHLY_CAP` is 5, reset on the calendar month in India time. Later fits are held for review, not refused.
    - **Referrals logged before January.** Credits imported from ops' log expire 365 days after the import.

## Inputs still owed

The inputs each milestone needs are listed in the Phase 2 plan and in the provisioning table of `docs/prompts/phase2-backend.md`. The FSM trial and licensing are in `docs/decisions/fsm-trial.md` and `docs/decisions/fsm-licensing.md`, both pending.
