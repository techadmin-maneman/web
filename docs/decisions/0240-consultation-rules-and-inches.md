# 0240. A consultation uses nothing from the kit, a first fit takes the profile, and the head is measured in inches

- Status: accepted
- Date: 2026-11-10
- Topic: Field work
- Amends [0106](0106-a-clients-hair-profile.md), which stands except on where the profile is taken and the head's unit

## Context

The owner's answers to the technician redesign's open questions (`docs/technician-redesign/PLAN.md`, sections 2 and 5)
change three rules the API holds, before the new screens draw them:

- A consultation looks and measures. It uses nothing from the technician's kit, so it records no consumables.
- At a first fit the technician measures the head again before the piece goes on, and corrects the profile the
  consultation left.
- Every measurement is in inches, as suppliers order a base. The head was in centimetres (ADR 0106).

The technician app works offline, and a phone may hold writes from the build before for a while after a release. The
console and a technician's phone each start a profile from the latest version and send it back whole, so a build that
reads no head measurements would send them back empty. The previous release must also be able to run again if this one
is rolled back.

## Decision

1. **A consultation's steps are its before photographs, its checklist and its outcome** (`src/policy/in-job-steps.ts`).
   A consultation and fit in one visit keeps every step, since it fits a piece. What a consultation was expected to use
   is deleted (migration 0202), and the console neither lists a consultation among the services that use the kit nor
   sets one (`src/domain/inventory/consumables.ts`), so the kit's checks and forecast count none for it. The deletion
   runs in the same release as the code, as a contract step: the Worker still running reads a consultation's list as
   empty, and asks no reason of a consultation that used nothing (ADR 0222).
2. **A consultation's consumables step from a phone of the build before is answered as landed and ignored:** nothing
   is recorded and nothing comes out of the kit, so no phone is stuck on a refusal. It is refused once a release has
   run.
3. **A first fit takes the profile** (`takesProfile`), in the card's steps just before the after photographs, as at a
   one visit. The new app's screens choose their own order (the plan, section 5).
4. **The head is measured in inches, expanded first and contracted later.** Migration 0202 adds
   `head_circumference_in`, `front_to_nape_in`, `ear_to_ear_in` and `temple_to_temple_in`, fills each from its
   centimetres divided by 2.54 to one decimal, and holds them to the table's rule that a version is only ever blanked.
   Until the centimetre columns go:
   - every version is written in both units, so the previous release reads it right;
   - a version only the previous release wrote is read in inches from its centimetres;
   - the API takes the head in centimetres from the build before (`FitSpecWriteSchema`), each measurement in one unit
     or the other, and gives it in both;
   - the data export gives inches alone, and an erasure blanks both; while the previous release still runs, a
     trigger blanks each inch column when that release's erasure blanks its centimetres.
5. **The ranges in inches:** head circumference 15.5 to 28; front to nape, ear to ear and temple to temple 7.5 to 20.
   Every centimetre figure the old ranges took lands inside them, and centimetres typed for inches stay refused.

## Consequences

- One decimal in inches is 2.5 mm, where one in centimetres was 1 mm. A figure taken in centimetres and turned into
  inches and back can move by a millimetre (57.5 cm is 22.6 in, then 57.4 cm).
- After a production release has run this code, a later PR drops the four centimetre columns, their trigger lines,
  the trigger that blanks the inches with them and the API's centimetre fields, and refuses a consultation's
  consumables step.
- A technician app that kept a profile in centimetres, on a card, in a draft or in a write still to send, has it put in
  inches when it opens this build (`apps/tech/src/store/upgrades.ts`, version 8).
- The technician app no longer shows the base in centimetres beneath its inches.
