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
12. **Bot Fight Mode** (ADR 0023, 2) challenges automated traffic across the zone and cannot be skipped per path on the free plan, so Razorpay, FSM and Evolution webhooks may be challenged. That adds to the case for turning it off. **Ruled 22 September 2026: turned off** by the owner.

## Phase 1 against Phase 2

13. **Prices.**
    - The Phase 2 designs price a standard base at Rs. 30,000 ex-GST (Rs. 35,400 at 18%) and a service visit at Rs. 2,000. The Phase 1 site, its FAQ and its terms say ₹25,000 and ₹1,500, without saying whether GST is included.
    - The landing page's "matching the site" is therefore false today.
    - Prices come from the price book; the Phase 1 site takes them from it once it exists.
    - **Open, before P2-M2:** the price book itself.
14. **Service area.** Phase 1 serves five NCR cities; the Phase 2 designs say Gurgaon only. Cities are derived from the pincode table in P2-M3. **Open, before production:** served pincodes include Delhi's, while an invite's preview still says "Home-fitted hair systems in Gurgaon." Since 25 September 2026 that line is one sentence in `packages/web-kit/invite.ts`, which the landing's Open Graph tags and the client app's preview (board F4) both show, so the ruling changes both at once; the landing's own copy (`site/src/content/referral.ts`) changes with it.
15. **Visit windows.** Phase 1 asks for one of four first-choice windows (weekday or weekend, morning or evening) and proposes "before noon" or "after six". Phase 2 offers morning 9–12, afternoon 12–4 and evening 4–8, and the dispatch board has four slots a day. The window-to-slot map is ruled on before P2-M4.
16. **Login eligibility before the mirror.** P2-M1's login needs "a booked consultation", but the FSM mirror arrives in P2-M2. Until then, eligibility comes from Phase 1 bookings that have a proposed visit date.

## The prompts and designs, where they are silent or disagree

17. **Ops boards D1, D2 and D3.** The Ops Console draws payments and a dispute (D1), tasks (D2) and technicians (D3). The design README says to build every section, and neither prompt covers them. D1 is the no-show and late-cancellation dispute queue the front-end prompt implies; D2 is the queue that partial outcomes feed; D3 is the roster, which carries device revocation. They are built in P2-F4, with their backend in P2-M4.
18. **Six technician steps.** The steps are before photographs, checklist, consumables, piece, after photographs and outcome. Board B3 draws steps 3 and 4 together, and the outcome is labelled "Step 6".
19. **Service visit length.** The Client App shows 90 minutes (B1) and the Referral landing "An hour" (C5). **Settled 24 September 2026** (`docs/open-points.md`, item 23): a service visit is 90 minutes and a first fit 180. The client app says so throughout, from the length FSM books and "Two slots · 3 hours"; the site's and the landing's own words are the site's to bring into line.
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
25. **Counsel's sign-off.** **Given 22 September 2026**, as the owner reports. It covers:
    - the five consent purposes and their wording;
    - the four referral-card lines (board F3);
    - retention: photographs 7 days after a deletion request, invoices 8 years;
    - our roles under the DPDP Act;
    - rulings 2 and 3 of item 24.
26. **The Zoho org.** The org the FSM trial runs in is the real one (ruled 22 September 2026). CRM is set up in it before production moves off the Developer Edition org (ADR 0020). Until then, staging's FSM and Books calls reach this real org, so its test records must be removed before go-live (`docs/open-points.md`).
27. **Staging runs on placeholders.** **Ruled 22 September 2026:** "take placeholder values for everything else. This is going to staging." Where an input is still owed, staging uses a placeholder and the build carries on. Each placeholder, and every other point to settle, is listed in `docs/open-points.md`, which is cleared before anything reaches production.
28. **How long a refund takes.** The design says "3 to 5 working days"; Razorpay's normal refunds take 5 to 7. **Ruled 22 September 2026:** the app says "5 to 7 working days".
29. **The UPI app on a payment.** Board E2 names it ("UPI · Google Pay"), but Razorpay's payment does not always say which app paid. **Ruled 22 September 2026:** the app shows "UPI" alone.
30. **The GSTIN on staging.** **Ruled 22 September 2026:** Books keeps `27AAPFU0939F1ZV` as a placeholder, which makes it treat the org as in Maharashtra. The real GSTIN replaces it before any real invoice (`docs/open-points.md`, item 3).
31. **GST on staging.** FSM would not sync with Books once GST was on in Books, since FSM keeps no GST settings of its own. **Ruled 22 September 2026:** GST stays off in Books on staging, and every staging price is at 0% (migration 0018), so billing and invoicing work end to end; GST is switched on for production, with the real GSTIN and the CA's rates.
32. **Technician states no board draws.** Neither the Technician App nor the Prototype draws a sign-out with unsent work or with no signal, a way back from a code sent to the wrong number, a phone that is full, a screen that failed to draw, or a camera asked for again. Each is built in the app's own outlined style, with no gold, and with placeholder words in `apps/tech/src/content.ts` (ADR 0053's update of 25 September 2026). One is a decision as well as words: **a sign-out with no signal keeps everything**, because only the API can end the session, and a phone wiped without it comes back signed in with its unsent work gone. The owner approves the words with the rest of the app's copy (`docs/open-points.md`, item 20).
33. **A free visit's badge.** The prompt says a technician's job "shows a Prepaid or Credit badge only"; board A1 writes "Free" on the consultation, and the technician was shown "Prepaid" on a visit nobody paid for. **Taken 25 September 2026, for the owner to confirm** (ADR 0065): a visit the price book charges nothing for on its day carries a third badge, Free, as the board draws it. It is still a badge and never an amount: the price book is asked in SQL for a yes or a no, and no figure leaves the database.
34. **Erasing a client with a visit booked.** Neither prompt says what a deletion does to a visit still to happen or to money we hold. **Interim, 25 September 2026 (ADR 0066):** the erasure is refused while there is either, and ops cancel and refund first; the operators' endpoint can override, for the same-day promise. **Open, before production:** whether an erasure should cancel and refund by itself once the money path can, and whether it should blank a check-in's coordinates, which place the technician's phone at the client's door.
35. **Which tier the app books.** The public site sells a standard and a premium tier of the first fit, the service visit and the replacement, and the price book, the hold and FSM's catalogue know only one: the app could book and charge a client measured for premium at the standard price. **Interim, 25 September 2026, for the owner to rule:** the booking sheet books the standard tier, as it says ("First fit · standard"), and its pay step offers "Premium? Message us", which opens WhatsApp to ops with a message ready. The owner rules how a client's tier is recorded (at the consultation, on the client, by ops) and whether the premium prices go into the price book; until then premium is booked by ops (`docs/open-points.md`, item 78).
36. **Where the client app departs from the boards for WCAG 2.2.** Taken 25 September 2026, for the owner to see:
    - **A field's and a switch's edge.** The boards edge them in `--paper-line` (#CEC6B4), 1.3:1 against paper and white, and the login's in `--ink-line` (#3A4A64), 1.75:1 against the ink: under the 3:1 that WCAG 1.4.11 asks of the boundary that shows where to type or what is switched. They are drawn in a new `--paper-control` (#8A8173, 3.0:1 on paper, 3.8:1 on white) and in `--ink-line-strong` (#6B7B95, 3.7:1 on the ink). Rules, dividers and the date strip's cells, which carry their own words, keep the design's lines.
    - **Keyboard focus** is one rule for the whole app, as on the public site: a 2 px ring in ink on paper and in paper on ink. It was gilt in places, which on paper is 1.86:1.
    - **Close on a sheet.** The boards draw the booking and change sheets with no way to close them. Close was there, unseen until the keyboard reached it; it now stands on the dark ground above the sheet, in paper, a full 44 px target.
    - **Targets.** A tab is the prompt's 64 px, where it was 63; a switch, drawn 26 px tall as G1 draws it, answers a tap 44 px tall; C7's "Cancel the visit instead" is 44 px tall.
37. **Asking for the reminder at booking.** The confirmation promised "Imran messages you the day before" to every client, and the reminder goes only to one who has switched on WhatsApp about their visits, which nothing in the app's booking asked for. **Taken 25 September 2026:** the pay step asks "Remind me on WhatsApp the day before", unticked, whenever it is off; ticked, it records that consent with its current notice (`whatsapp-visits-v1`, "WhatsApp about your visits"), as the profile's switch does. The confirmation promises the message only when the consent is on. The checkbox's words are not the notice's own line, so **the owner and counsel confirm the wording**, or a notice version is written for it (`docs/open-points.md`, item 40).
38. **The technician boards, where a gloved tap or the sun needs more than they draw.** **Taken 25 September 2026, for the owner to confirm** (ADR 0053's update of 25 September 2026, "The job flow"):
    - **Contrast.** The board's contrast table is wrong about two pairs it draws: the disabled action, `#A8B2C2` on `#2A3A56`, is 5.34:1, not the 7.0 it claims, and an angle not yet taken, `#8C96A8` on `#131C2E`, is 5.71:1, under the 5.8 floor. The app draws disabled text in `#C5CDD9` (7.13:1) and an angle to take in `#A8B2C2` (7.96:1). `test/node/tech-contrast.test.ts` now checks every pairing the app's stylesheets use: at least 5.8:1, and 7:1 for all but the board's own label pair, `#8C96A8` on `#0E1728` (6.01:1).
    - **Close as no-show** is outlined, not gold, and asks first ("Ops may charge the client"): the board draws it gold, and when the wait ran out it sat 64 px tall above a gold Start job, one mis-tap from a chargeable no-show as the client opened the door.
    - **The outcome** starts with nothing chosen, and Next stays dim until Done or Partial is: the board draws Done already chosen, in gold, above a gold Next.
    - **The one action is at the foot of every screen**, the door's included: I have arrived, then Start job, sit where Continue and Next do, and board B1's Capture sits there beside Retake and becomes Done once the five are taken, rather than a second bar beneath it.
    - **The card reaches the client**: Call and WhatsApp beneath Navigate, from the mobile the card already carries, and a "Near …" line for the landmark. The prompt's "No telephone number anywhere" is the client app's rule; the board draws neither.
    - **What no board draws**, in the app's outlined style with placeholder words (`apps/tech/src/content.ts`): what changed on a job ops moved, above every screen and across its card; a step the API refused, opened again to be put right; a no-show refused as early; a close-out opened before the job closed; the question before "Got it" deletes a job's photographs; a label typed wrong, or checked with no signal; the piece that came off, and why it failed. The owner approves the words with the rest of the app's copy (`docs/open-points.md`, item 20).
39. **Two Tasks groups board D2 does not draw.** A finished visit whose invoice is still a draft, which the client cannot open, and an erased client whose FSM contact the sweeper could not anonymise, each need a person and had nowhere to wait. **Taken 25 September 2026 (ADR 0067):** both are groups on the Tasks board, read from the rows as the others are, in the board's own style, with placeholder words in `apps/ops/src/content.ts` ("Draft invoice", "Erasure left in FSM"). An erased client's row names the day they were erased, since their name is gone. The owner sees them with the board's other undrawn groups (`docs/open-points.md`, item 58).
40. **The client's screens, where the boards draw less than the client needs.** **Taken 25 September 2026, for the owner to confirm** (ADR 0043's second update of 25 September 2026; ADR 0059, amended):
    - **Home's one prompt** (board B1) is the first of three that applies: no address given while something is booked; the month the piece in wear falls due, whenever one is in wear, as B1's "default" draws it six months ahead; an invoice issued in the last fortnight. A lead with a consultation and no address sees the first beneath board B2's steps, which B2 does not draw: the technician cannot find the door without it. "See what that involves" opens WhatsApp to us with a message ready, since the app has no page on what a replacement involves. Every line but the replacement's is a placeholder (`docs/open-points.md`, item 81).
    - **A visit FSM has not closed** stays on Home and under Visits until FSM closes it, reading "Today · in progress" in its window and "Being closed" after it, with Reschedule gone and Add a note kept, and no booking offered on Visits while it is; the design draws neither state. Home prefers a visit still to come to one being closed.
    - **An upcoming visit opens its own page**, which C1 does not draw: Home's card for it, with its ways to change it.
    - **The share sheet** is one dialog, as ADR 0043 has it, drawn as each board is: F2 and F4 fill the screen, F3 rises over the dark ground. F2's back arrow closes it, and F4 has Close in its top corner, where the board draws none (item 36). F2 draws the client's own card from their two front photographs before it is made; F4's bubble has no time.
    - **Documents over time.** An invoice still missing a day after its visit says it is late and offers a message, where E3 says "usually ready within the hour" for ever; a charge and a late fee offer the receipt alone, since the visit's invoice is neither's and nothing invoices them (`docs/open-points.md`, item 79); a refund still processing past ten days says it is late.

## Inputs still owed

The inputs each milestone needs are listed in the Phase 2 plan and in the provisioning table of `docs/prompts/phase2-backend.md`. The FSM trial and licensing are in `docs/decisions/fsm-trial.md` and `docs/decisions/fsm-licensing.md`, both pending.
