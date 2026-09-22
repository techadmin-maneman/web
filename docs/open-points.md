# Open points before production

Staging runs on placeholders wherever an input is still owed (ADR 0025, item 27). Every placeholder is listed here, with every other point that must be settled before Phase 2 reaches production. Nothing goes to production while an item here is open. When one is settled, record the answer, the date and where it now lives, and move it to "Settled" at the end.

How to hand over each answer is in `docs/phase2-inputs.md`.

## Money and tax

| #   | Point                                                | Staging uses                                                                                                                                                 | Before production                                                                                                    |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| 1   | The price book                                       | The design's figures: base ₹30,000, service visit ₹2,000, late fees ₹4,000 (first fit) and ₹3,000 (replacement). The replacement price is a placeholder too. | The owner sets every price (`docs/phase2-inputs.md`, section 5).                                                     |
| 2   | GST rates and codes                                  | 18% on everything, codes left blank                                                                                                                          | The CA answers the seven questions in section 5. The price book and documents take the answers.                      |
| 3   | GST in Books                                         | Books has no GSTIN or tax rates, so staging issues no GST documents (receipts and invoices are placeholders)                                                 | The owner enables GST in Books with the GSTIN. The invoicing route (section 6) is confirmed against the CA's answer. |
| 4   | Books plan                                           | The Premium trial                                                                                                                                            | Choose the plan: Standard, or Professional if retainer invoices are used.                                            |
| 5   | Razorpay webhook secret                              | None yet                                                                                                                                                     | Created with the webhook when its route exists (P2-M2).                                                              |
| 6   | Razorpay live mode                                   | Test keys                                                                                                                                                    | KYC, live keys and a live webhook (P2-M5).                                                                           |
| 7   | Late fees, the refund route, a late-cancelled credit | The design's figures and rules                                                                                                                               | The owner confirms them (P2-M5).                                                                                     |
| 8   | Self-serve booking                                   | Off: booking goes through WhatsApp                                                                                                                           | The owner switches on `SELF_SERVE_BOOKING` (P2-M5).                                                                  |

## Zoho

| #   | Point                            | Staging uses                                                                                                 | Before production                                                                          |
| --- | -------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| 9   | **The FSM and Books trials end** | Trials started 22 September 2026: FSM's lasts 15 days, then drops to Free, which has no assets or job sheets | **Subscribe before they end** (FSM Professional), or staging loses features.               |
| 10  | Staging shares the real org      | Staging's FSM and Books calls reach the real org; its records are marked as tests                            | Remove every staging test record from the org before go-live, or give staging its own org. |
| 11  | CRM in the real org              | Production still uses the Developer Edition org (ADR 0020)                                                   | Set up CRM in the real org and move production over (ADR 0020's steps).                    |
| 12  | Technicians in FSM               | The owner is the only user and technician                                                                    | Add each technician as a user with their territory.                                        |
| 13  | The job-sheet template           | A placeholder template                                                                                       | The owner builds the real checklist, consumables and partial reasons in FSM (section 2).   |
| 14  | Overlapping appointments         | FSM allows them. Our own clash check stops double-booking.                                                   | Turn off "Allow overlapping appointments" in FSM's settings.                               |
| 15  | The licence for our own apps     | Building on staging against the trial org                                                                    | Zoho's written answer (`docs/decisions/fsm-licensing.md`).                                 |
| 16  | FSM webhooks                     | Set up on staging when the routes exist (P2-M2)                                                              | Set up for production, pointing at production's routes.                                    |

## Messages and copy

| #   | Point                       | Staging uses                                                                      | Before production                                                             |
| --- | --------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 17  | Login codes by SMS          | WhatsApp only; SMS off                                                            | DLT registration and MSG91 (section 11).                                      |
| 18  | A dedicated WhatsApp number | The shared Evolution instance, whose webhook goes to n8n, so no delivery receipts | A Mane Man number on its own instance, with its webhook to us (plan input 2). |
| 19  | Message texts               | Placeholder wording in `src/config/message-templates.ts`                          | The owner approves each text.                                                 |
| 20  | App copy                    | Lines marked PLACEHOLDER in `apps/app/src/content.ts` and the other apps          | The owner approves each line.                                                 |

## Service and operations

| #   | Point                  | Staging uses                                                                | Before production                                                             |
| --- | ---------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 21  | The service area       | All 198 pincodes in `data/pincodes/ncr-pincodes.csv` served, launched today | The owner marks the served pincodes and their launch dates (section 7).       |
| 22  | Ops' referral log      | A synthetic sample                                                          | The real log in `private/referrals-before-january.csv` (section 9), imported. |
| 23  | Service visit length   | 90 minutes (board B1)                                                       | The owner rules between 90 minutes and "an hour" (ADR 0025, item 19).         |
| 24  | The window-to-slot map | Morning 9–12, afternoon 12–4, evening 4–8, as the designs draw them         | The owner rules (ADR 0035).                                                   |
| 25  | Piece labels           | A placeholder format, no barcode                                            | The owner sets the format, and whether labels carry a barcode or QR code.     |
| 26  | The geocoder           | FSM's own geocoding of service addresses                                    | Confirm FSM's is enough, or choose Ola Maps or Mappls (ADR 0036).             |
| 27  | Technicians' phones    | Any phone                                                                   | Company Android phones (strongly preferred for offline storage).              |

## Release

| #   | Point                              | Staging uses                                                    | Before production                                                                                                                   |
| --- | ---------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 28  | Phase 1 in production              | Waiting                                                         | The owner's go-ahead releases Phase 1 and Phase 2 together.                                                                         |
| 29  | Production's app Workers           | Not bootstrapped                                                | Bootstrap `mm-app-production` (and later `mm-ops-production`, `mm-tech-production`), then add each to the `mm-ci-production` token. |
| 30  | Production's Access service policy | Parked: `mm-ci-production` does not appear in the policy picker | Add the Service Auth policy for `mm-ci-production` on production's Access apps.                                                     |
| 31  | Analytics IDs                      | None                                                            | The owner supplies them.                                                                                                            |
| 32  | Production's queue for FSM         | Not created                                                     | Create `mm-fsm-sync-prod` before the first production deploy that sends to it, then run `apply-triggers` (runbook 11b).             |

## Settled

- **The profile shows the whole address.** Ruled 22 September 2026 (ADR 0025, item 23).
- **The six referral rules.** Ruled 22 September 2026, as recommended (ADR 0025, item 24).
- **Counsel's sign-off** on consents, the referral-card lines, retention, DPDP roles and the referral naming rules. Given 22 September 2026 (ADR 0025, item 25).
- **Bot Fight Mode is off.** 22 September 2026 (ADR 0025, item 12).
- **The Zoho org the trial runs in is the real one.** 22 September 2026 (ADR 0025, item 26).
- **The FSM trial findings** are recorded, apart from webhooks (`docs/decisions/fsm-trial.md`).
