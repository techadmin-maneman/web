# 0106. A client's hair profile: the fit spec and their history

- Status: accepted, on the owner's ruling of 1 October 2026 ("Fit spec + history"); who records it, who sees it, the consent its history needs and where it lives were taken by the build, for the owner to confirm (ADR 0025, items 95 to 99)
- Date: 2026-10-01
- Amends [0094](0094-where-a-consent-was-given.md), whose `technician` source had no writer; follows [0105](0105-a-consultation-and-fit-in-one-visit.md), whose one visit records the product chosen, [0038](0038-offline-writes.md) and [0087](0087-consumables-and-stock.md)

## Context

Asked what we record about leads and clients, the owner learned that we keep a three-level loss extent from Phase 1's form, a visit's photographs, and each piece's label, base, lot and dates: no head size, colour, density, Norwood stage, remedies tried or product. Board A3's piece card reads "Tier, Base, Colour, Adhesive, Template, Scalp", and the technician app drew only the piece's own rows, since nothing recorded the rest (`apps/tech/src/content.ts`).

Offered "Fit spec + history", "Fit spec only" or "Not now", the owner chose **"Fit spec + history"** on 1 October 2026:

- **Fit spec:** Norwood stage I–VII; head measurements (circumference, front to nape, ear to ear over the top, temple to temple, in centimetres); base size (width × length, in inches, as suppliers order); colour code (#1, #1B, #2 …) and grey percentage; density (80, 100, 120, 140%); wave (straight, slight wave, wavy, curly); hairline style; the product (ADR 0103's range, the first-fit services ADR 0105's one visit chooses from); tape, glue or both.
- **History:** remedies tried (none, minoxidil, finasteride, transplant with its year, other hair systems, other: many may apply), and skin conditions and allergies, as short free text.

## Decision

The rules are `src/policy/hair-profile.ts`, which quotes the ruling and the defaults below.

### Every version is kept

**`hair_profiles` holds a row for each version** (migration 0063), each the whole profile as it stood when it was recorded: the fit spec's fourteen fields and the history's three, every one nullable, since a technician may take some and not others. The latest version is the profile, and a replacement is ordered to it. The phone and the console each start from the latest and send the profile back whole, so a version never depends on the one before it to be read.

- **The technician's** is keyed to the visit and to the phone's `X-Client-Event-Id`, under a unique index, so a replay records nothing more and is answered as the first (ADR 0038). It names the technician.
- **Ops' correction** names neither, and names the member of staff instead, by their Access e-mail. A `CHECK` holds every row to exactly one of the two.
- **A version is never changed and never deleted.** A trigger refuses every update but one that blanks a field, which is what an erasure does, and a client withdrawing the consent to their history; another refuses a delete.
- **The lists are codes in code**, not a `CHECK`: their words are the owner's to give (open point 174), and a list a `CHECK` held could change only by rebuilding the table. The API checks every code against `src/policy/hair-profile.ts`, every measurement against its range to one decimal (centimetres for the head, inches for the base, each wide enough for any head and narrow enough that centimetres typed for inches are refused), and the product against the services table's first fits, retired or not.

### Who records it

**The technician, at a consultation and at a consultation and fit in one visit** (ADR 0025, item 95). The card's steps put a profile step just before the after photographs (`cardStepsFor`, `src/policy/in-job-steps.ts`): a consultation measures and explains, and a one visit has by then had its product chosen and fitted. A one visit the client declined is a consultation, and keeps the step.

**The step is no job event.** `job_events` checks its kinds, and D1 could take a new one only by rebuilding a table others reference (ADR 0105). So `POST /api/tech/jobs/{id}/profile` writes its own table: it is refused, as any step is, for a job that changed under the phone (`409 superseded`, ADR 0038) and before the start (`409 out_of_order`, field `start`), but the order the API holds a job's events to leaves it out, so a phone that never sends it holds nothing back, and it goes to no queue. The card's `progress.steps_done` names it once a version was recorded at the visit, so the phone moves past it.

**Offline as every step is.** The phone queues the write in its outbox under a UUIDv7 and sends it in order; one the API refuses (a figure out of range, a product no longer held) reopens the step to be put right, from what was sent (`apps/tech/src/steps/Profile.tsx`). The phone checks each figure against the API's ranges before Next takes it (`apps/tech/src/steps/profile-form.ts`, held to the policy by `test/node/tech-profile-form.test.ts`).

**Ops correct it** on the client's page in the console (`GET` and `POST /api/clients/{id}/hair-profile`), on the Pieces tab above the pieces, which also lists every version, who recorded it and at which visit. A correction is a new version, audited as `hair_profile.correct` by the client's ID and the version's alone. Ops may record a first profile where no visit took one.

### Who sees it

**Technicians and ops; not the client's app this round** (ADR 0025, item 96; open point 175). Every unlocked card carries the client's latest profile, withheld until the day before the visit as the client and the address are, and the piece card reads the board's tier, colour, adhesive and scalp from it, with the base's size. The board's template is recorded nowhere, so it is not drawn. The phone keeps the card, profile and all, for the day, as it keeps the client's name and address, and wipes it with everything else on a 401 (ADR 0052).

### The history needs its own consent

**Remedies tried, skin conditions and allergies are health information** (ADR 0025, item 97). Before the phone shows a question of them, it shows the client a consent of its own, a new purpose, `health_history`, on its own notice, `health-history-v1`, and the technician records their answer: they agree, they decline, or the technician did not ask.

- **Agreed:** the consent is recorded with the history, in one batch, on the notice the phone showed, source `technician` (ADR 0094), and no address of the client's, since the phone is the technician's. The same answer on the same notice writes no second row (ADR 0058). A client who agreed to these words is not asked again; a new notice asks again.
- **Declined:** the refusal is recorded, only the fit spec is, and any history recorded before is blanked in every version, since a consent withdrawn stops the processing it allowed. A client who agreed before may withdraw at any visit the same way.
- **Not asked:** no consent is written, and the version holds no history.
- **Ops never give one.** A correction may carry a history only while the client's consent stands; otherwise it is refused, field `history`.

The purpose is apart from the five a client switches in the app (`CONSENT_PURPOSES`), so no screen of the client app shows it, and the console's Consents tab is unchanged; the profile's section says whether the client agreed. `consents` checks its purposes, so migration 0063 rebuilds it to take the new one, as migration 0009 did: nothing references it, every row is copied with its rowid, by which the code tells a person's consents of one moment apart, and its index and append-only triggers are made again.

**The words are a placeholder awaiting counsel** (open point 173), in `src/config/notices.ts` and word for word in `apps/tech/src/content.ts`, which a test holds together. Marked PLACEHOLDER, they stop the technician app's production build, so no production phone asks for the consent on them.

### Where it lives

**Our D1 alone** (ADR 0025, item 98). The fit spec is not summarised to FSM: a piece reaches FSM as an asset with its label, base and lot (ADR 0065), and nothing of a fit spec ever went there. The history never reaches Zoho CRM, FSM or Books, a log line or the audit log: `src/domain/hair-profiles.ts` is the only file that names the table (`test/node/hair-profile-readers.test.ts`), no queue or provider reads it, the routes log IDs and fields only, and the audit entry names the version.

- **An erasure blanks every version**, field by field, in its one batch (ADR 0066); who took each and when stay, and the consent is withdrawn as every purpose given is (ADR 0019).
- **The export** a client asks for (`GET /api/me/export`) carries every version, the history with it.

## Consequences

- **Migration 0063** adds `hair_profiles`, its two indexes and two triggers, and rebuilds `consents` with every row unchanged. The Worker deployed before it names neither.
- **The contract:** the card's `profile`, its `products` on a consultation as on a one visit, `profile` among its `steps` and `steps_done`; `POST /api/tech/jobs/{id}/profile`; `GET` and `POST /api/clients/{id}/hair-profile`; the export's `hair_profile`. Regenerated documents and types.
- **What the build took is the owner's to confirm** (ADR 0025, items 95 to 99): who records it, who sees it, the consent and what declining does, where it lives, and the lists and ranges. The words, the lists' and the consent's, are placeholders (open points 173 and 174), and whether clients see their profile is open (175).
- **Board departures** (`docs/fidelity-method.md`): the profile step and the console's section, which no board draws; the piece card's rows read from the profile, with the base's size added and the template left out.
- Tests: `test/node/policy-hair-profile.test.ts`; `test/node/migration-0063.test.ts` (the rows kept, the purpose taken, a version only blanked); `test/worker/hair-profile.test.ts` (the step, its replay and refusals, the consent and what declining does, nothing to FSM or a log line, the console's read and correction and its audit, the erasure, the export); `test/node/hair-profile-readers.test.ts`; `test/node/tech-profile-form.test.ts`; `test/worker/one-visit.test.ts` (the one visit's steps); `e2e/tech/steps.e2e.ts` and `e2e/ops/clients.e2e.ts`, with axe.

## What this does not do

- **It shows the client nothing.** The client app neither shows the profile nor switches the history's consent; a client withdraws it at a visit, or by an erasure (open point 175).
- **It sends nothing to a supplier.** A replacement is still ordered by hand, now to the latest version.
- **It records no template**, which the board's piece card names and the ruling does not.
