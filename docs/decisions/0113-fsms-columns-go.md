# 0113. FSM's columns go

- Status: accepted
- Date: 2026-10-06
- Topic: Field work
- Follows [0110](0110-field-work-without-fsm.md): FSM is gone, and its columns are what is left of it

## Context

FSM no longer holds anything: visits, pieces and technicians are ours (ADR 0110). Its names stay in the schema:

- **Two columns still in use.** `appointments.fsm_invoice_id` holds a visit's invoice in Zoho Books. `fsm_write_state` on `dispatch_moves` and `job_events` holds whether our own write landed: `pending`, `written` or `rejected`.
- **Ten columns and a table nothing reads.** On `appointments`: `fsm_work_order_id`, `fsm_note_written_at`, `fsm_status` and `fsm_modified_at`, with the two indexes on `fsm_work_order_id`. `fsm_error` on `dispatch_moves` and `job_events`. On `consumables`: `fsm_item_id`, `fsm_name` and `fsm_checked_at`. `consumables_used.fsm_item_id`, which points at the `fsm_items` table.
- **`fsm_id`** on `appointments`, `pieces` and `technicians` is each row's unique key. Rows booked here carry their own ID in it (ADR 0110).

A migration reaches an environment while the Worker before it still serves, so a column in use cannot be renamed in one step (`docs/migrations.md`, rule 2). Production runs a release from before the FSM exit, which reads all of these columns.

## Decision

1. **`fsm_invoice_id` becomes `books_invoice_id`, and `fsm_write_state` becomes `write_state`,** in three releases:
   1. **Expand** (migration 0104). The new columns are added, the code writes both, and the migration copies the old into the new. Every read stays on the old columns.
   2. **Read the new.** The next release reads the new columns, with indexes made for them, and copies across again whatever the Worker before it wrote only to the old ones.
   3. **Contract.** Once production has run the second release, a migration drops the old two columns, their indexes, and the `dispatch_moves` trigger that names `fsm_write_state`. The trigger is made again on `write_state`.
2. **The ten unread columns and `fsm_items` go with the contract,** once no deployed Worker reads them. `consumables_used.fsm_item_id` is a foreign key, which SQLite will not drop, so `consumables_used` swaps it out in place first (`docs/migrations.md`, rule 5), and `fsm_items` goes after.
3. **`fsm_id` stays.** Renaming the key of three tables means rebuilding each in place, which risks more than a name gains. Its description says what it holds now (`docs/schema.md`).
4. **The technician API's `fsm_write_state` field keeps its name** until the technician app reads `write_state`, in a release of its own.

## Consequences

- `docs/migrations.md`, "Contract steps waiting", lists each drop and the release it waits for.
- Until the contract, both columns are written. A read of the new column before the second release finds the rows the Worker before it wrote empty, so nothing reads it yet.
- `grep -i fsm` still finds `fsm_id`, the API field until it moves, and the migrations that ran.
