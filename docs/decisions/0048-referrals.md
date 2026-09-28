# 0048. Referrals and the waitlist

- Status: accepted. Amended by ADR 0060: while self-serve booking is off, the landing records a request for ops rather than refusing. The landing page and the app's Refer screens were built in P2-F3. Amended by ADR 0080: a consent to cards given by booking a visit, on the pay step's lines, names the referrer too. Amended 27 September 2026: where the phone can share files, the card goes with the invite as a photograph (below). Amended by [ADR 0089](0089-an-invite-is-not-lost.md): attribution also happens on `/book`, with an invite the friend's browser remembered for 30 days, and when ops attach an invite on the client's page, under the same rule.
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

- Each pincode's area is the shortest name among its sub and head post offices, until ops give better ones. **Amended 26 September 2026:** ops name an area in Settings · Service area, and the import keeps a name they gave (ADR 0071).
- Staging runs with every pincode served (`--all-served-from`, open point 48).
- `GET /api/pincodes/:pin` says served or not, with the area, and refuses what is not an Indian pincode.

**A client's code** (`referral_codes`) is their initials and four random characters from an alphabet without look-alikes (no 0, O, 1 or I). It is never taken from their mobile number, and is made the first time they open Refer (`GET /api/refer`). The code also holds the card's state (house or personal) and version.

**The invite** (`GET /api/r/:code`) is valid or unknown, with the card to show.

- It names the referrer by first name only if their latest consent to photographs on referral cards was given on the notice that says so. That is `photos-referral-cards-v2`: the four lines, and "Your first name appears on your invite." (ruling 2). The app shows the same five lines. Since ADR 0080 it is any notice for cards that carries that line, the pay step's included (`NAMING_NOTICES`, `src/config/notices.ts`).
- `REFERRER_NAME_ON_INVITE` switches the name off everywhere.
- An erased referrer's invite stays valid, with the house card (ruling 1).

**Attribution** (`referral_attributions`) happens once, to the first invite a person uses, and only while they are new: not the referrer, and not already fitted. It starts pending; the grant, holds and review arrive next.

**The landing's two actions**, each taking Turnstile and the booking form's per-number and per-address limits:

- `POST /api/r/:code/consultation` books a free consultation straight into the schedule: a hold, then the queue, as a free booking in the app.
  - The page's line "You may contact me on WhatsApp about this consultation." is recorded as consent to WhatsApp about visits, on its own notice (`referral-consultation-v1`), so the confirmation and reminder reach them (ADR 0047).
  - It answers whether the invite's credits apply, and the invite's state for this friend: `expired` once the one held for them on a waitlist has lapsed, 12 months after their area launched (ADR 0068).
  - While self-serve booking is off, it books nothing and records a request for ops instead: the person, the consent, the invite's attribution, the lead and a `consultation_requests` row, answered `201` with `state: "requested"`. Until 24 September 2026 it answered `409 ops_assisted` ([ADR 0060](0060-an-invited-friend-reaches-ops-and-the-crm.md)).
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

**The card** (`src/domain/referral-cards.ts`) is a 1200 x 630 JPEG under 300 KB, composed on the client's phone from their first fit's photographs, in a Worker, with board A1's 2 px gilt rule and its lockup (since 25 September 2026: `apps/app/src/refer/card-layout.ts`, from which the house card is drawn too). The app composes it before it records the consent, so nothing is agreed to for a card the phone could not make.

- `PUT /api/refer/card` stores it, only with their consent to photographs on referral cards, as the code's next version; `DELETE /api/refer/card` takes it down.
- **Every upload or revoke is a new version,** because WhatsApp caches a link's preview by its URL: a revoke reaches new shares only, and never a card sent as a photograph (amended 27 September 2026, below).
- **`GET /api/og/:code.jpg`** is the preview: the client's card while it is live, and otherwise the house card, a static file of the site's. It is served by mm-api, so the path stays under `/api`, and the versioned link makes it safe to cache for a day.
- **A card comes down by itself** when the consent is switched off, and when the client is erased: it is made of their photographs.
- The house card is a placeholder until the owner gives us a licensed one (`docs/open-points.md`, item 52).

**The waitlist and a launch** (`src/domain/waitlist.ts`), on the ops surface:

- `GET /api/waitlist` lists each pincode with someone waiting: how many, the longest wait, how many came through an invite, and how many asked to be told.
- `POST /api/pincodes/:pin/launch` first answers what it would send. Confirmed, it marks the pincode served from the day given and queues a launch alert for each person who asked for one and still consents.
  - The alerts leave ten a minute, so a launch does not flood the number.
  - Nobody is told twice: the entry keeps when it was alerted.
  - The launch is audited.
- `GET /api/referrers` gives ops each referrer's figures: opens, consultations, fits, grants and the credits spent. Opens are counted on the invite; the referrer never sees them (the tracker shows fits only).
  - **No "sent".** The front-end prompt's funnel for board C2 starts with it ("Sent, opens, consults, fits, granted, redeemed"), and nothing can count it: a client shares their link from their own phone, through WhatsApp or the share sheet, and nothing reaches us until a friend opens it. The console leaves the column out rather than show a count that is not one (recorded 27 September 2026; ADR 0025, item 57).

**The pre-January log** is imported by `scripts/import-referrals.ts` from ops' CSV, into people, codes, attributions and the ledger. Credits imported expire 365 days after the import (ruling 6). Running it again writes nothing twice: a person and a referral keep the same IDs, from their numbers.

**Afterwards, on the same cron:**

- A grant past its expiry is closed with an expire entry, once (`expireCredits`).
- A referral whose friend's first fit was refunded in full, under the guarantee, has what is left of both sides' credits clawed back (`clawBackRefunded`).

## Consequences

- The consultation a friend books is in FSM at once, like any booking in the app.
- The landing page itself (mm-site's Worker entry, ADR 0027), the card upload, and the versioned Open Graph image arrive with the rest of P2-M3.

## Amended 27 September 2026: the card goes with the invite

The owner found invites shared from the app reaching WhatsApp with no image. The card reached a chat only as the preview WhatsApp draws of the invite's link, and three things stood in its way:

- **The app sent only words.** WhatsApp's button opened `wa.me/?text=…`, and Other apps shared the words alone. Where the phone's share sheet takes files (`navigator.canShare` with the card), both now send the card itself, a JPEG named `mane-man-invite.jpg`, with the invite's words, link and all, as its caption (`apps/app/src/refer/share.ts`), as the site's try-on shares its look (ADR 0022, item 23).
  - The card is made a file before the share step shows, since a share must start on the tap: the house card from the app's own copy, one just made as the phone made it, and a stored one from the API (below).
  - Elsewhere WhatsApp's link stays, with the words, and the chat draws the card from the landing's preview as before.
  - A share the phone refuses is F6's "Share failed"; one the client backs out of says nothing.
  - The owner approved this on 27 September 2026, a departure from boards F4, B1 and B2, which draw the link's preview (ADR 0025, item 71). F4 still draws that preview, which is what the friend gets where the phone cannot send the file.
- **A client's own card was a broken image in F4.** The app asked for it at `GET /api/og/:code.jpg`, which answers only on the public host (ADR 0026). `GET /api/refer/card` gives the client their own card on the app's host while it is live, exactly when the landing would show it (stored, the consent given, the client not erased), and a 404 otherwise. The phone keeps it a day, under the version in its link.
- **Staging's Access turned WhatsApp's crawler away** from the landing and the card, as it turns away anyone without the founders' login. The owner is to let `r/`, `images/` and `api/og/` through (runbook, step 10b). `npm run smoke -- --base <host> --environment <env> --link-preview <code>` fetches both as the crawler does, with no Access token. No deploy runs it: it fails on staging until then.

The landing's tags also give the card's type and its HTTPS address beside it (`og:image:type`, `og:image:secure_url`), and the preview's answer gives its length.

**A revoke cannot reach a card sent as a photograph.** A preview comes from us whenever WhatsApp fetches it, so a revoke reaches new shares, and old ones once their preview is fetched again. A photograph sent in a chat is a copy: it stays there, and wherever it is forwarded or saved, whatever the client does next. The consent's lines already say so ("Cards already delivered stay in people's chats. We cannot take those back.", board F3), as the revoke's do ("Cards already sent stay in those chats."), so neither changes.
