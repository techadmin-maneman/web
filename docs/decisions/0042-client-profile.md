# 0042. The client's profile: address, consents, number change, deletion

- Status: accepted. Amended by ADR 0080: booking a visit in the app also gives the two photograph consents the client has never decided on.
- Date: 2026-09-22
- Contract step for `migrations/0009_consents_v2.sql`

## Context

P2-M1 gives the client app its profile (design board G). The prompt's rules (`src/policy/`):

- **Consents.** Each of five purposes carries its own date, and the client switches it in the app. Ops can read them and never grant them.
- **Number change.** A code goes to both numbers. The change then waits for ops to confirm, and takes effect only after that confirmation.
- **Account deletion.** Photographs are deleted within seven days and invoices kept eight years, both pending counsel's sign-off.

Phase 1's `consents` table is the legal record of what each person agreed to. It is append-only, enforced by triggers, and its CHECK allows only Phase 1's three purposes.

## Decision

**One consent record, rebuilt once** (migration 0009, a contract step):

- `consents` keeps every row and gains Phase 2's five purposes: `photos_own_record`, `photos_referral_cards`, `photos_marketing`, `whatsapp_visits` and `whatsapp_launches`.
- The purposes stay checked in the database, unlike message kinds (ADR 0041), because this is the legal record. A new purpose is rare enough to earn a rebuild.
- The append-only triggers are recreated with the table.
- `test/node/database/migration-0009.test.ts` applies the real migrations to SQLite. It shows every row surviving, the triggers refusing changes, and an unknown purpose refused.

A switch is a new row (`PATCH /api/consents/:purpose`), naming the notice version the client saw. The current state of each purpose is its latest row, so every consent carries its own date. A purpose is off until the client first switches it on. The notices are in `src/config/notices.ts`:

- four in the profile design's words ("Photographs for your own record", and so on);
- the referral-card notice, with the four lines the design shows before a card is turned on;
- the launch alert, as the waitlist asks it ("Tell me when you launch in my area.").

Counsel's sign-off is still owed, so the notices are not yet pinned as published.

**No ops route writes a consent**, which is what "ops can read them and never grant them" comes to. Ops read consents on the client page, in P2-M2.

**Addresses keep their history.** `PATCH /api/profile/address` adds a row and marks the old one replaced, so a visit booked to an earlier address can still be read. `lat`, `lng` and `geocoded_at` are empty until a geocoder is chosen (plan input 16, P2-M4).

**A number change needs both codes, then ops:**

1. `POST /api/number-change` sends a code to each number, on its own challenge (`number_change_old`, `number_change_new`). These codes follow the login's rules (ADR 0030), but no login accepts them. Starting again withdraws a change under way, and a client may start three a day.
2. `POST /api/number-change/verify` checks one number's code. With both proven, the change waits for ops.
3. Ops see the changes waiting at `GET /api/number-changes`, and `POST /api/number-changes/:id/decision` confirms or rejects one. Confirming moves the person to the new number, unless another person holds it (`409 number_in_use`). A rejection needs a reason.

**A deletion request is ops' to process.** `POST /api/deletion-request` records one open request, however often it is asked. Ops see them at `GET /api/deletion-requests`. "Delete" runs the Phase 1 erasure at once (ADR 0019), which is well within the seven days; "reject" needs a reason.

**Audited** (ADR 0031):

- a consent switch, in the same batch as the switch;
- a number change and a deletion request, as each is made;
- ops' decisions under the member of staff's Access identity, each in the same batch as the decision it records (ADR 0066), so a deletion is recorded only if the erasure happened.

## Consequences

- **Zoho still has the old number** after a confirmed change: Phase 1's CRM sync creates leads and erases them, and has no update. FSM becomes the record for clients in P2-M2, and the change is written there then.
- **Invoices kept eight years** begin with Books (P2-M2). Until then there are none to keep.
- **The ops console's screens** for these queues come with P2-F2. Until then the routes are the ops side.
- **The ops surface has its own API documents**, `docs/openapi-ops.json` and `docs/api-ops.md`.
- **Tests:**
  - `test/worker/app/client-profile.test.ts` names each rule by its words in `src/policy/`. It also covers address history, the append-only switches, a number change's code opening no login, withdrawal, the daily limit, a number already in use, reasons for rejections, a deletion made once and processed by erasure, and nothing audited for a request that is not waiting.
  - `test/node/database/migration-0009.test.ts` covers the rebuild.
