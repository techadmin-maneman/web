# 0106. A client's hair profile: the fit spec and their history

- Status: accepted, on the owner's ruling of 1 October 2026 ("Fit spec + history", recorded in ADR 0025); the defaults below are the build's, for the owner to confirm
- Date: 2026-10-01

## What was built

- **The record.** `hair_profiles` (migration 0063) keeps every version of a client's profile, each the whole profile as it stood: the fit spec (Norwood stage, the head's four measurements, the base's size, colour and grey, density, wave, hairline, product, tape or glue) and the history (remedies tried with a transplant's year, skin conditions and allergies). The latest version is the profile. A trigger lets a version be blanked and nothing else. The lists are codes in `src/policy/hair-profile.ts`, not a `CHECK`, so the owner can change them without a migration.
- **The technician's step.** At a consultation and at a consultation and fit in one visit, just before the after photographs (`POST /api/tech/jobs/{id}/profile`): the fit spec, then the history's consent in its own words, then the history. Offline like every step, once per phone event. It is no job event (a new kind would mean rebuilding `job_events`), so it never reaches FSM; it needs only the start, and is refused for a job that changed under the phone.
- **The consent.** The history is recorded only with a consent of its own, purpose `health_history`, on the notice the phone showed (`health-history-v1`), source `technician`. A client who declines, or withdraws at a later visit, has the fit spec alone and any history before blanked in every version. `consents` is rebuilt in migration 0063 to take the purpose, every row kept with its rowid.
- **Who sees it.** Technicians: the card carries the latest profile (withheld until the day before, as the address is), and the piece card reads tier, colour, adhesive and scalp from it, with the base's size. Ops: the Pieces tab shows the latest, every version and who recorded it, and a correction form; a correction is a new version, audited by IDs alone, and carries a history only while the client's consent stands.
- **Where it lives.** Our D1 alone: no queue, provider, log line or audit entry carries it (`test/node/hair-profile-readers.test.ts`). An erasure blanks every version; the client's export carries them.

## Defaults the build took, for the owner to confirm

1. The technician records it at a consultation and a one visit; ops correct it; every change is a new version.
2. Technicians and ops see it; the client's app does not, neither the profile nor a switch for the history's consent.
3. Declining the history's consent, or withdrawing it at a visit, blanks the history in every version.
4. The fit spec is not sent to FSM (pieces never carried one there).
5. The lists: stages I to VII; colours #1, #1B, #2 to #8; densities 80 to 140%; four waves; hairlines natural, receded, straight, widow's peak; six remedies; tape, glue or both. The ranges: circumference 40 to 70 cm, the other head measurements 20 to 50 cm, base 2 to 12 by 2 to 14 inches, each to one decimal; grey 0 to 100%. Their words are placeholders (open point 42).

## What the owner and counsel must decide

- **Counsel: the consent's words** (open point 173). They are placeholders; the technician app's production build refuses them until they are replaced.
- **The owner:** the five defaults above, the lists' words, and whether clients should see their profile, and switch the history's consent, in the app.
