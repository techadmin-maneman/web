# The owner's answers of 27 September 2026

The open points of `docs/open-points.md` and the rulings the Decision Ledger asked the owner to confirm, put to the owner one at a time on 27 September 2026. Each entry keeps the point's number, the question as it was asked, the answer as it was given, and what follows from it. Once an answer is built or recorded where it lives, `docs/open-points.md` moves the point to "Settled" and names this file.

A ruling of ADR 0025's register is written "ruling N", so that its number is never read as an open point's.

## Money and tax

**A standing rule, given with items 1 and 7.** "All the policies can change and I want them to be an ops update, not a tech update." Every price and every business rule is set in the ops console, and the console is the source of truth that FSM and every other system follows. What is still a constant in code (item 12, and the rules below) moves into the console's settings.

- **1. The price book.** Asked: are staging's figures (consultation free, first fit ₹30,000, service visit ₹2,000, replacement ₹15,000, before GST) the production prices? Answered: "The price book will keep getting updated. The source of truth needs to be the one entered on the ops dashboard which should then sync to FSM and every other thing." Follows: prices stay set in the console; the push to FSM's catalogue goes on (item 11); the console's services and prices become editable and removable (the owner's request of the same day, below).
- **7. Late fees, the refund route, a late-cancelled credit.** Asked: confirm the terms as built (free more than 24 hours ahead; inside 24 hours a first fit costs a ₹4,000 late fee and a replacement ₹3,000, a paid service visit is kept, a credit is lost; a move by ops never charges). Answered: "This is ok, but this also needs to come from the ops dashboard. All the policies can change and I want them to be an ops update, not a tech update." Follows: the terms are confirmed as they stand, and the notice period and what each visit type costs inside it become console settings.
- **15. What waiving a no-show gives back.** Answered: the payment is refunded and the credit returned. Follows: `WAIVER_GIVES_BACK` goes on, and under the standing rule it becomes a console setting rather than a constant.
- **141. How long a paid booking waits for FSM.** Answered: hold it and alert ops. Follows: after the fifth refusal the slot and the payment are kept and ops are alerted once; the queue keeps trying hourly for 24 hours, and ops book it in FSM or refund it from the console.
- **4. Books plan.** Answered: Standard (₹749 a month billed yearly). Follows: subscribe before the trial ends (item 18); Professional only if the CA's answer to item 9 needs retainer invoices.
- **6. Razorpay live mode.** Answered: not started. Follows: KYC starts now; the live keys and the live webhook (item 5) come in the go-live sequence.
- **8. Self-serve booking.** Answered: on at launch, once one booking has been paid through Checkout on staging end to end (item 91). Follows: `SELF_SERVE_BOOKING` goes on in production with the release, gated on that proof.
- **10. Refunds in Books.** Answered: split test from real. Follows: production refunds from "Razorpay"; staging's `BOOKS_REFUND_ACCOUNT_ID` moves to a new account, "Razorpay – staging test", so no test refund reaches the real account.
- **13. Which tier a client is booked at.** Asked: where is a client's tier decided and recorded? Answered: "The services should be selected via the ops table which should sync with FSM. Clients should see all the available options. There should be no message us for anything." Follows: each tier is its own service in the console's table of services, priced in the price book and pushed to FSM's catalogue; the app offers the client every service open to them and they choose; "Premium? Message us" comes out.
- **11. Prices ops can change.** Answered: production only. Follows: `FSM_CATALOGUE_PUSH` goes on for production; staging keeps the hourly check and its alert while it shares the owner's org.

**A second standing rule, given with item 13 and narrowed with ruling 44.** "There should be no message us for anything", narrowed the same day to: "Message us needs to be removed just for products. For issues like this, we can keep message us." Every hand-off that sends a client to WhatsApp to buy or book a service (premium, a replacement, the next visit, what a replacement involves) is replaced by a step in the app; a hand-off about a problem (a late invoice, a refund's voucher) stays.

## Zoho

- **20. A client is a customer in the CRM, not a lead.** Answered: FSM's CRM Contact is the customer record, and the Lead is marked. Follows: at a client's first completed first fit the CRM sync sets the Lead's status to "Client", so nobody works them as an enquiry; the service history goes on the Contact once item 21's token exists.
- **21. The CRM token cannot reach Contacts.** Answered: the owner mints the Self Client with `ZohoCRM.modules.contacts.ALL` (runbook, step 8). Follows: the Contacts write and the Contacts erasure ship in one change.
- **30. The licence for our own apps.** Answered: "I have received it. Close this point." Follows: settled; Zoho's written answer is to be filed with `docs/archive/fsm-licensing.md`.
- **32. One Zoho token budget for every proof.** Answered: a separate token. Follows: scripts and proofs run on their own Self Client refresh token, so they can never spend the Worker's ten access tokens in ten minutes.
- **33. Converting a Request by API.** Answered: we link it. Follows: every booking's work order is created with its `Request`, so FSM moves the Request on by itself (ADR 0064).
- **34. The CRM's referral fields.** Answered: set them up. Follows: `scripts/setup-crm.ts` on the org, proved with `scripts/check-zoho-setup.ts`, then `CRM_ORG_HAS_REFERRAL_FIELDS` goes on.
- **35. The CRM's workflow rules.** Answered: the owner rule only. Follows: a lead who gives contact consent is assigned an owner, and nothing fires for "Try-on — delivery only"; no rule emails on a booking, which the console and the technician app already show.
- **36. The Zoho tokens' scopes, and the tokens kept in D1.** Answered: narrow the scopes and keep the access tokens in D1 as they are. Follows: new refresh tokens with only the scopes each sync uses (runbook, section 8 and step 11b).
- **19. Staging shares the real org.** Answered: a script, dry run first. Follows: a script lists every staging-marked record in FSM and Books for the owner to review, and a second run deletes them; the ₹30,000 receipt `4242595000000065003` is deleted by hand first.
- **29. Overlapping appointments.** Answered: turn it off. Follows: "Allow overlapping appointments" off in FSM's settings, done by the owner.

## Messages and copy

- **38. A dedicated WhatsApp number.** Answered: a Mane Man number on its own Evolution instance. Follows: the instance's webhook comes to us, so delivery receipts reach mm-api; SMS stands behind it (item 37) in case the number is ever blocked.
- **37. Login codes by SMS.** Answered: start DLT now. Follows: launch on WhatsApp; SMS goes on as the fallback for login codes once DLT clears (entity, sender ID and templates, then MSG91).
- **39, 41 and 42. Message texts, the messages people are owed, and app copy.** Answered: one Word file to mark up. Follows: every WhatsApp text and every line marked PLACEHOLDER is exported, grouped by message and by screen, into one `.docx`; the owner edits it with tracked changes, and their wording is committed. The consents each message is sent on stay with counsel (item 41).
- **40. Messages about visits.** Answered: the reminder goes from 6 pm the day before. Follows: under the standing rule the hour becomes a console setting (Settings · Rules), starting at 18:00; the checkbox's words wait on counsel with the notice.

## Consumables, stock and FSM (the owner's questions of the same day)

- **Does FSM manage inventory?** Found: FSM holds a catalogue of services and parts, and parts with quantities can be written onto a work order; stock levels and their deduction come only from the Zoho Inventory integration (FSM Professional, Books Premium and Inventory Professional), which deducts only when an invoice is sent, so a free consultation or a credit visit would never deduct. **Stock** answered: our own ledger. Follows: the consumables list and each service's expected use are set in the console and synced to FSM's catalogue as parts; stock on hand, deliveries, counts and reorder alerts are kept in our own system. Books stays on Standard (item 4).
- **Consumables on the client's tax invoice.** Answered: internal only. Follows: a job's consumables are kept in our records and in FSM's job summary, and are not written as lines on the work order, so the invoice is unchanged.
- **28. The job-sheet template.** Answered: in the ops console. Follows: the checklist for each visit type, the consumables with their expected quantity per service, and the reasons for a partial job are console settings the technician app reads; the consumables reach FSM as parts.
- **18. The FSM and Books trials end.** Answered: FSM Professional, 100 appointments a month (₹2,500 a month billed yearly), and Books Standard (item 4). Follows: the owner subscribes before the trials end on or about 7 October 2026; staging's appointments count against the same allowance while staging shares the org.

## Booking (the owner's questions of the same day)

- **Consultation, or consultation and first fit, from the booking form.** Found: `/book` and `/r/:code` book a free consultation only, take no payment, and a first fit is booked and prepaid in the app once the consultation is completed. Answered: book the consultation and request the fit. Follows: the form offers "A consultation" or "The consultation, then my first fit"; the second books the consultation and records a first-fit request in the same write; the fit is booked and paid in the app after the consultation, and ops see any request not yet booked on the Tasks board. No money is taken before the free consultation.
- **70. From the consultation to the first fit.** Answered: no minimum. Follows: the fit may be booked as soon as the consultation is completed; the gap becomes a console setting starting at 0 days, so a lead time can be set later without a release.
- **The service cadence.** Answered: monthly, 30 days. Follows: a console setting starting at 30 days; the referral landing's "every four weeks" is corrected to agree with the main site's "twelve monthly service visits".
- **How service visits are booked.** Found: nothing books or prompts the next service; the technician cannot book, ops book in FSM, and a client books in the app only unprompted. Answered: the client books. Follows: the moment a first fit, service or replacement closes, the app offers the next service on its due date (the last visit plus the cadence), and reminders follow while nothing is booked; the technician does not book.
- **Who books the first fit.** Answered: the client, in the app. Follows: as the consultation closes, the app offers "Book your first fit" with every first-fit service the console lists, and the client chooses; the technician does not book.
- **Next-service reminders.** Answered: one WhatsApp reminder 7 days before the due date, on the client's consent to WhatsApp about their visits, and an "At-risk client" task for ops 7 days after it (board D2's group, open point 61). Both figures are console settings.
- **The booking horizon.** Answered: 45 days. Follows: the horizon becomes a console setting starting at 45 days (item 12), so a service due in 30 days can be booked the day the last visit closes.
- **Replacements.** Answered: booked and paid in the app. Follows: Home's due prompt opens the booking sheet at the replacement services the console lists, prepaid through Checkout; the WhatsApp hand-off comes out.

## Messages and copy, continued

- **43. The service area's name.** Answered: Delhi NCR. Follows: settled as it stands (`serviceArea`, `site/src/content/service.ts`).
- **45. Words the site adds where no design draws any.** Answered on the flat or house number: required. Follows: both the site's form and the app require it, and it reaches FSM's service address (item 150). The other words go into the Word file of item 39.
- **46. Home's prompt.** Answered: the order (1) no address while something is booked, (2) the next service due and not booked, (3) the piece falling due, (4) an invoice issued in the last 14 days, the fortnight a console setting; and an in-app page on what a replacement involves in place of the WhatsApp hand-off.
- **47. The footer's telephone number.** Answered: the same number, shown as WhatsApp. Follows: the footer's `tel:` link becomes a WhatsApp link to +91 90079 73247.

## Service and operations

- **48. The service area.** Answered: the owner sets production's served pincodes and launch dates in the console before launch. Follows: no release; the point closes when production's console holds them.
- **49. Ops' referral log.** Answered: none to import. Follows: settled; production's log starts empty and `private/referrals-before-january.csv` is not needed.
- **51. DPDP contacts and times.** Answered: the owner is the Grievance Officer. Follows: the owner's name and the address grievances go to are written on the privacy page and into the breach runbook; counsel confirms the 30 days.
- **52. The house referral card.** Answered: the owner supplies it (1200 × 630, under 300 KB, licensed photographs).
- **51, the address.** Answered: a role address rather than a personal one. Follows: grievances go to a role address at maneman.in (grievance@maneman.in proposed); the owner's name and the confirmed address are still owed for the privacy page.
- **53. The window-to-slot map.** Answered: keep the design's slots and windows. Follows: they become a console setting starting from today's figures (item 12).
- **54. The geocoder's key.** Answered: fix the key from a checklist. Follows: the owner applies the checklist (the Places API (New) and the Geocoding API enabled, billing linked, a server key restricted to those two APIs and not to browser referrers, the quotas of runbook section 13), staging proves a pinned address, then production gets its own key and `GEOCODE_PROVIDER` goes to `"google"`.
- **56. The check-in radius.** Answered: 200 m for launch, tuned in the console from the field test's recorded distances (item 72).
- **58. How far a technician's phone is trusted about time.** Answered: keep all three: a check-in at most 60 minutes before the booked start, a write held up to 24 hours still believed, and an offline check-in waiting out 15 minutes on our clock before a no-show can be closed. Follows: each becomes a console setting at today's figure.
- **59. Board D3's jobs, service time and skill.** Answered: counts over 90 days, an average flagged at 15 minutes over, and no Skill column. Follows: the two figures become console settings.
- **60. Board D1's money, and the dispute.** Answered: "Yes, both. Keep them separately editable in the console." Follows: a charged no-show costs, to begin with, what a late cancellation of the same visit costs (first fit ₹4,000, replacement ₹3,000, a paid service visit kept, a credit lost), set in the console apart from the late-cancellation terms so either can change alone; the client disputes a charge in the app, and ops rule Refund or Uphold in the console with a reason, and the client is told.
- **61. Board D2's owner, its SLAs, and its other two groups.** Answered: assign owners. Follows: ops take or assign a task to a named member of staff (their Access e-mail) and the board shows whose it is; At-risk client is built from the cadence (7 days past the due date); Photo QA is not built.
- **62. Tasks only the thing itself can close.** Answered: yes to both. Follows: ops may close a partial visit's task without a follow-up, with a required reason kept under who closed it; and ops may record on the client's page an address the client gives them on the phone, marked as given to ops.
- **64. A client's note in FSM.** Answered: write it to FSM. Follows: FSM's note on an appointment is tried on staging first, then the note is written there too.
- **65. An unchanged address is geocoded again on every save.** Answered: keep calling. Follows: settled as built, on the strict reading of Google's B.6.3.2; `GEOCODE_DAILY_CEILING` bounds it.
- **66. Photo thumbnails.** Answered: the phone makes the thumbnail. Follows: the technician app writes a small copy beside each photograph at capture and uploads both; the client app shows the small copy in each row.
- **67. The dispatch board's block heights.** Answered: heights follow the slots, about 42, 63 and 84 px (a departure from board A1).
- **68. Who sees the log of a client's photographs being opened.** Answered: any ops user, and the client's data export carries it.
- **69, the owner's half. Photographs at a consultation.** Answered: before photographs only. Follows: a consultation takes the five before photographs and no after set; the consent they are taken on waits on counsel (item 69's other half).
- **71. A move by ops inside the last day.** Answered: the client keeps the free change. Follows: after a move by ops, the client's notice counts from the visit's time before ops moved it.
- **72. The technician field test.** Answered: the first technician with the owner, once that technician is set up in FSM with his mobile number (item 27).
- **125. Photograph sizes.** Answered: copy FSM's photographs anyway, at FSM's size. Follows: settled as built; R2 is watched by the storage meter (item 142).
- **151. The photograph runway, with clients' looks kept.** Answered: keep the look at full size and pay for R2 beyond the free tier when it fills. Follows: the storage meter (item 142) warns ops at 50% and 80% of the share, and R2's paid storage is accepted as the share fills.
- **50. A client's page in the ops console.** Answered: a consent records where it was given. Follows: each consent row keeps its source (the site's form, a booking in the app, the profile's switch, the technician) and the console shows it; the tier is answered by item 13's services.

## Release

- **82. Phase 1 in production.** Answered: the site first, the apps later. Follows: the public site, the try-on and consultation booking go live as soon as the home page's material (items 73–81) and counsel's legal pages (item 44) are ready; the client app, the technician app, the console and payments follow in a second release.
- **84. Analytics IDs.** Answered: Google Analytics 4 and the Meta Pixel, both. Follows: the owner supplies the GA4 measurement ID and the Pixel ID; a cookie consent banner is built, since both set cookies; the privacy page gains their lines; counsel words them with item 22, since the Pixel is used for marketing.
- **144. Cloudflare Web Analytics.** Answered: the site only. Follows: the client app's policy keeps the beacon out; ops still record whether Web Analytics is on for the site's hostnames (runbook, step 14).
- **87. HSTS preload.** Answered: not now. Follows: settled; revisit once the domain's hosts are settled.
- **88 and 89. Where CI runs, and GitHub's gates.** Answered: GitHub Team. Follows: `CI_RUNNER` stays `github` on Team's included minutes; every `ci.yml` job is required on `main`; the `production` environment deploys only from `main`; merged branches are deleted. Whether required human reviewers on a private repository's environment need a higher plan is checked when Team is bought.
- **105. One status for each error code.** Answered: make them consistent. Follows: `session_required` answers 401 and `invalid_request` 400 everywhere, changed in the API, the site and the apps in one release with the contract tests.
- **106. One signing secret for every purpose.** Answered: keep one secret. Follows: settled as built; the secret is rotated on any suspicion of a leak.
- **107. The Phase 1 lead routes.** Asked by the owner: under what scenarios would they be used? Answered by us: none today; nothing calls them but our staging check and load test, and a Turnstile token from our own page stops any outside source using them. Answered: remove them. Follows: `POST /api/lead` and `GET /api/cities` go; the staging check and the load test book through `/api/consultation`.

## The home page's material

- **73 to 81.** Answered: the owner supplies cleared material for all nine: the hero film (73), the membrane photograph (74), the Norwood photographs (75), the try-on teaser's pair (76), the four step photographs (77), the two bases' photographs (78), the technicians (79), the testimonials (80) and the founder's note (81). Follows: each goes into `site/src/assets` with `publish: true` as it arrives (`docs/frontend.md`); the site's launch (item 82) waits on them.

## The rulings the Decision Ledger asked the owner to confirm (ADR 0025's register)

- **Ruling 33. A free visit's badge.** Confirmed: Free, Prepaid or Credit, never an amount.
- **Ruling 34. Erasing a client with a visit booked.** Confirmed, with the coordinates blanked. Follows: the erasure stays refused while a visit or money is outstanding, ops cancel and refund first, and the operators' override stands; an erasure also blanks a check-in's coordinates; once the money path is proven (item 91), the erasure cancels and refunds by itself.
- **Ruling 36. Where the client app departs from the boards for WCAG 2.2.** Confirmed.
- **Ruling 37. Asking for the reminder at booking.** Confirmed; the checkbox's words go to counsel with item 40.
- **Ruling 38. The technician boards, where a gloved tap or the sun needs more than they draw.** Confirmed; the words go with item 42.
- **Ruling 40. When an invite is said to have expired.** Confirmed: the landing opens as valid and "Code expired" stands beneath the confirmation, without "Book anyway".
- **Ruling 41. The site's forms and a number we already know.** Confirmed.
- **Ruling 42. Two minutes' grace, a charged consultation from the site, and ops' credit reasons.** Confirmed; the grace becomes a console setting under the standing rule.
- **Ruling 43. Where the booking pages go past boards C1 to C5.** Confirmed; the words go with item 45.
- **Ruling 44. The client's screens, where the boards draw less than the client needs.** Answered: "Message us needs to be removed just for products. For issues like this, we can keep message us." Follows: confirmed as built, save that the replacement's "See what that involves" becomes an in-app page (item 46); a late invoice keeps its message to us.
- **Ruling 45. The dispatch board, where the boards and the prompt leave a move open.** Answered: message everyone. Follows: a move ops make is sent on WhatsApp to every client, whatever their consent to WhatsApp about visits, as a service message about a visit they booked; "Call about a move" is left only for a message that fails. Counsel confirms the basis for sending it without that consent (DPDP Act 2023, s.7), with item 41.
- **Ruling 46. A tax invoice that does not total what the visit was sold for.** Confirmed: sent only when FSM's total equals what was paid; otherwise a draft for ops.
- **Ruling 48. The console's clients and queues.** Confirmed.
- **Ruling 49. The ops console's frame and Settings.** Confirmed, with item 67's block heights.
- **Ruling 50. The messages people are owed, and the hand-offs no board draws.** Confirmed; a waiver's money follows item 15, the texts go in the Word file and their consents with counsel (item 41).
- **Ruling 51. What a button does that no board draws, and two try-on moments.** Confirmed, with rupees written "Rs." everywhere. Follows: the one formatter writes "Rs. 25,000" on the site and the landing as well as in the apps, the console and the messages.
- **Ruling 58. The mark below its smallest size.** Answered: the boards; the headers keep 28 and 24 px.
- **Ruling 59. Gold beyond the prompts' one action.** Answered: the prompts' rule. Follows: gold marks only the one primary action; the technician app's offline banner, a step's progress, a ticked checklist box and a chosen outcome or reason, and the dispatch board's first-fit rule, turn neutral.

## Engineering follow-ups the owner ruled on

- **92. A job given to another technician names nobody.** Answered: the other technician's first name may reach the phone. Follows: the card says who the job went to and when, by first name.

## Faults the owner reported on 27 September 2026

- **The referral message on WhatsApp carries no image.** Found: (1) on staging only, Cloudflare Access stands in front of every page, so WhatsApp cannot fetch `/r/:code`, `/images/invite-house.jpg` or `/api/og/:code.jpg` to build its preview; (2) everywhere, the app shares text alone (a `wa.me` link, or `navigator.share` with text), never the card; (3) a card already stored shows as a broken image in the app's own preview, since `/api/og` answers only on the public host. Answered: both fixes. Follows: the app shares the card as a photograph with the invite as its caption wherever the phone can share files, keeping the `wa.me` link as the fallback (a departure from boards F4, B1 and B2); the app reads a stored card from its own host; and the owner adds an Access bypass on staging for `r/`, `images/` and `api/og/`.
- **A technician's sign-in code is not sent.** Found, without staging's logs, as the likely cause: the owner signs in as a technician row written by hand into staging's D1 (`tech-tester-…`). Since #113 (on staging from 25 September 2026, 02:38 UTC) `syncTechnicians` switches off every technician FSM does not list, and FSM lists only the owner's own user, so the nightly sync, or any sign-in with a number the mirror does not know, switched the test row off. `POST /api/tech/auth/otp` then finds no active technician and answers 202 with no message, which is its uniform answer, so the screen still says a code is on its way. Answered: the owner puts their own mobile number on their FSM user, so the sync lists them as a real technician will be listed (item 27). Follows: the code keeps hand-written staging technicians out of the sync's switch-off, logs every request that sends no code and why, and reads a pasted "+91" number correctly; the docs of item 27 and `docs/technician-test-setup.md` are corrected.

## How the rest is taken forward

- **Counsel's points (22, 23, 40, 41, 44, 55, 63, 69, 146, 148, 149, and ruling 45's basis).** Answered: one brief for counsel, as a Word file: each question, what the app does today, the options, our recommendation and the exact words needing approval.
- **The CA's points (2, 3, 9, 14, 16, 17).** Answered: one brief for the CA, as a Word file.
- **Setup only the account holders can do.** Answered: the owner does it from a numbered checklist with the exact clicks and commands (the go-live runbook).
- **12. Business inputs still in code.** Answered by the standing rule: visit lengths, blackout dates, the booking horizon, the payment hold and the window times move into the console.

## Services, as the console will hold them

- **The model.** Answered: every service belongs to one of four kinds (consultation, first fit, service visit, replacement), and the kind decides the technician's steps, the booking rules and which fees apply; within a kind ops add, rename, price, reorder and retire services from the console, each synced to FSM; a new kind needs a release. Retiring a service stops clients seeing it from a date and changes nothing already sold; prices stay dated rows.
- **Visit length.** Answered: each service carries its own length, starting from its kind's (consultation 60 minutes, service 90, replacement 135, first fit 180), and the scheduler reserves that length.
- **The CRM and products.** Answered: through FSM only; FSM's own sync carries the catalogue to Books and, where its CRM integration is on, to the CRM. We write no products to the CRM.
- **Where stock is held.** Answered: in each technician's kit and a central store; a job's use comes out of the kit of the technician who did it; ops record deliveries and transfers; low stock is alerted per kit.
