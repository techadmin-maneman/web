# 0052. Technician sessions, devices and the day-before unlock

- Status: accepted. Amended 4 October 2026 by [0110](0110-field-work-without-fsm.md): switching a technician off is ours alone; FSM's user is not read.
- Date: 2026-09-23

## Context

The prompt: "Mobile number plus a one-time code, the same flow as clients but a separate role. A technician is recognised only if FSM lists him as an active field technician. His sessions are bound to a device and can be revoked by ops. Revoking also wipes the device's cached jobs on its next contact."

And: "Jobs further out show only time, type and sector. The address, access notes and client card unlock the day before, **and the API enforces this, not just the screen**."

Two things were missing. `technicians` held no mobile number, so nothing could match a number to an FSM user; and `otp_challenges.person_id` references `people`, so a technician had no subject to hang a challenge on. `otp_challenges.purpose` has a `CHECK`, which SQLite cannot widen without rebuilding the table the client's login is using.

## Decision

**The number comes from FSM's user record.** `technicians` gains `mobile_e164` and `zone` (migration 0027), written by the mirror from FSM's `/users` answer, along with `active`. A technician whose FSM user carries no number cannot log in — which is the same sentence as "a technician is recognised only if FSM lists him", read strictly. The list refreshes nightly with the reconciliation, and once more on a login attempt the mirror does not recognise, so a technician added today does not wait until tomorrow. **From 25 September 2026** (ADR 0065) a technician the refreshed list leaves out altogether — FSM drops a user whose service resource was removed — is made inactive too, and a session whose technician is inactive ends on its next call, so one who has left keeps neither his login nor the cards on his phone. **Amended 27 September 2026:** but not a technician written by hand into staging's database for a test, the tester's (`scripts/staging/seed-technician-tester.ts`) or the staging proof's. FSM never lists him, so its list says nothing about him: he is marked `hand_written` (migration 0046), and the refresh leaves him alone. Whoever a refresh does make inactive is logged, `technicians_deactivated`, by FSM ID.

**The challenge is the client's, with a different subject.** `otp_challenges` gains `technician_id` (a new column, not a widened `CHECK`). A row carries a person or a technician, never both; the client's login reads only the rows where `technician_id IS NULL`, and the technician's only the rows where it is not. Same ten minutes, same five wrong attempts, same silence about whether the number is known.

**The session is bound to the phone.** `POST /api/tech/auth/verify` takes the app's own `device_id` — from its storage, never a hardware serial — and writes the session against a `technician_devices` row. A fresh login on the same phone reuses that row and revokes the session it replaces, so one phone holds one live session.

**A revoked phone learns it on its next call:** `401 device_revoked`, the cookie cleared, and `wiped_at` written once. The app drops its cached jobs on that code. Revoking is an ops action behind Access, and audited (ADR 0031).

**The unlock is enforced where the answer is built.** A locked job's detail is constructed without an address, access notes or client card — not merely without them rendered. The sector (the address's area) is the one place-fact a locked job carries, because the prompt lists it among "time, type and sector".

**No amount is read.** A job carries a `prepaid` or `credit` badge, computed from whether a credit was redeemed against it. No query in the technician surface selects an amount, so none can leak into a response. **From 25 September 2026** a third badge, `free`, marks a visit the price book charges nothing for; SQL asks the book for a yes or a no, and no figure is selected (ADR 0065).

## Consequences

- Ops can take a lost phone out of the fleet in one call, and know from `wiped_at` whether it has been back since.
- A technician who changes his number in FSM changes the number he logs in with, which is right: FSM is the record.
- A technician with no number on his FSM user cannot log in, and the error he sees is the same as any unknown number. `docs/open-points.md` item 27 now covers the number as well as the territory. (Amended 27 September 2026: the log tells the two apart. A code request that sends nothing logs `login_code_not_sent` with its reason, "no account holds the number" for this one.)
- The client's login gained a `technician_id IS NULL` filter on two queries. Nothing else about it changed, and no row that existed before has the column set.
