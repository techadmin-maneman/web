# 0066. Erasure is all or nothing

- Status: accepted. Amends the order in ADR 0019 and the record of a deletion decision in ADR 0049.
- Date: 2026-09-25

## Context

The audit of 24 September 2026 (findings LIFE-01, ARCH-02, OPS-02) found three ways an erasure went wrong:

- **It failed on a foreign key, after deleting the photographs.** ADR 0019 put R2 first so that "a failure part-way leaves the person findable". But the D1 batch deleted a client's addresses while a technician's check-in still pointed at one (`checkins.address_id`), and their number changes while the login codes of a change still pointed at them (`otp_challenges.number_change_id`). The batch failed every time for those clients. By then their try-on photographs, results, visit photographs and referral card were gone, the person's details and sessions were not, and repeating the erasure failed the same way.
- **The ops console audited a deletion that did not happen.** `deletion.decide` was written before the erasure ran (ADR 0031's "before the action it records"), so each failed attempt left an entry saying the account had been deleted.
- **It erased a client with a visit still booked.** A prepaid service stayed scheduled, with the technician sent to an address that no longer existed and the money kept.

## Decision

**One D1 batch, then the files.**

- The batch blanks the person and everything personal they left, ends their sessions, voids their codes, cancels their unsent messages and expires their try-on jobs. Before deleting a row, it first clears or deletes every row that points at it:
  - an address a technician's check-in was measured against is blanked to its city and pincode instead of deleted. The check-in points at it, and the no-show evidence reads a check-in with no address as "not measured", so detaching it would change what ops rule a charge on;
  - the codes of a number change are deleted with the change.
- The caller's own statements go in the same batch: the ops decision's audit entry and the request's new state. So a decision is recorded only if the erasure happened, and a failed erasure changes nothing and can simply be asked for again.
- Then the files are deleted from R2, each before the row that names it. If R2 fails part-way, the person stays erased, and `people.files_erased_at` stays empty (migration 0036). The cron's `erased_files` job deletes what is left, a few people a run, and sets it.
- Visit photographs' rows and their sets now go with the files, after the batch, rather than in it. A referral card shows the house card from the batch on; its file and `card_key` go after it.

**Nothing is erased while something is still owed.** Until the money path can cancel and refund on its own, an erasure is refused while the person has:

- a visit still to happen (`scheduled`, `dispatched` or `in_progress` in the mirror): `409 visit_booked`;
- a payment we captured with no visit behind it, and nothing refunded: `409 payment_held`.

The answer names each visit and payment. A payment on a visit follows its visit: a live one is refused above, a done one was earned, and a cancelled one was refunded or kept under the cancellation rules (ADR 0046).

- In the ops console, the deletion decision refuses, the request keeps waiting, and the console says which of the two it is.
- `POST /api/erasure` refuses the same way, unless the operator sends `override_open_bookings: true` (the script's `--override-open-bookings`). The same-day promise can then still be kept. The Worker logs `erasure_override` with the counts, and the runbook's "Erasure within the day" has ops cancel and refund by hand that day. A refund needs none of the person's details.

The rule lives in `src/policy/account-deletion.ts`. It is ours, not the prompt's.

## Consequences

- ADR 0019's "R2 goes first. If it fails, nothing in D1 has changed" no longer holds. D1 goes first, and R2 is finished by the cron. ADR 0049's "Visit photographs: deleted from the client-photos bucket, and their rows with them" still holds, a moment later.
- A photograph can outlive its person's erasure by up to one cron run while R2 is failing. The row naming it stays until the file is gone, so nothing is lost track of.
- Before, a check-in against a client's address blocked their erasure for good, and a number change for about a day.
- **Not covered:** a cancelled visit whose refund failed. The payment then stays captured against a cancelled visit, and the money path's own alerting is where that surfaces.
- ADR 0049's "Saved addresses: deleted" holds, but for an address a check-in was measured against, which keeps its city and pincode as the appointment does.
- **For the owner and counsel:** a check-in's own coordinates are where the technician's phone was at the client's door. They stay on the check-in as the technician's record, as the visits do. Whether an erasure should blank them too is open.
