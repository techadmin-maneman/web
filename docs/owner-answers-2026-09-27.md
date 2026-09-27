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

**A second standing rule, given with item 13.** "There should be no message us for anything." Every hand-off that sends a client to WhatsApp to ask ops for something is replaced by a step in the app. The list of those hand-offs, and what replaces each, is in the implementation plan.

## Zoho

- **20. A client is a customer in the CRM, not a lead.** Answered: FSM's CRM Contact is the customer record, and the Lead is marked. Follows: at a client's first completed first fit the CRM sync sets the Lead's status to "Client", so nobody works them as an enquiry; the service history goes on the Contact once item 21's token exists.
- **21. The CRM token cannot reach Contacts.** Answered: the owner mints the Self Client with `ZohoCRM.modules.contacts.ALL` (runbook, step 8). Follows: the Contacts write and the Contacts erasure ship in one change.
- **30. The licence for our own apps.** Answered: "I have received it. Close this point." Follows: settled; Zoho's written answer is to be filed with `docs/decisions/fsm-licensing.md`.
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
