# 0084. A client's try-on is kept

- Status: accepted, on the owner's ruling of 27 September 2026 (ADR 0025, item 65). The notices it needs await counsel (`docs/open-points.md`, item 146), so production keeps today's rules until then; what it costs Phase 2's photograph runway is the owner's (item 151), who ruled on 27 September 2026 to keep the look at full size and accept R2's paid storage as the share fills. The runway figures below were worked before each photograph had a thumbnail; [0093](0093-the-storage-meter.md) gives today's: 444 visits, 1,312 with no try-on kept
- Date: 2026-09-27
- Amends [0082](0082-try-ons-in-the-app.md) and [0039](0039-phase-2-budget.md); follows [0014](0014-try-on-api.md), [0019](0019-erasure.md) and [0028](0028-photographs-from-the-app.md)

## Context

The app shows a client's try-on while its retention rule holds it (ADR 0082). The photograph they uploaded is deleted an hour after the look asked of it (`PHOTO_RETENTION_MS`), so a client who signs in later sees the look alone. Told so, the owner ruled on 27 September 2026:

> "Show the before photo always, keep the generated image till the photos for first fit are taken."

Three things stood in the way:

- **R2's budget.** The photograph is up to 5 MB. Kept as long as its look, at production's upload ceiling, it would add up to 5.6 GB (ADR 0082), and R2 is the one allowance the free plan bills past 10 GB (ADR 0009). The budget test fails past 80% (ADR 0039).
- **The notices.** `photo-v1` says the photograph is "Used for: Generating your simulation. Nothing else." and "Kept for: Thirty days"; `gate-v1` says "Your photograph is deleted after thirty days"; the privacy page says the same. Keeping either for longer needs notices that say so, in counsel's words.
- **The results bucket's 30-day lifecycle rule**, which would delete a look kept past it.

## Decision

**Whose try-on is kept: a client's** (`src/policy/kept-try-ons.ts`, which quotes the owner's words).

- **A client** is someone with a visit booked: an appointment of theirs, from the app, the site's self-serve booking or ops in FSM, or a booking the site's forms took (a `form` lead).
- **Only a try-on agreed to under a notice that says so**: `photo-v2` (below). One agreed to under `photo-v1` keeps today's rules, whoever made it, since that is what its notice promised.
- **Only while its look is held.** A try-on is kept if its person is a client by its look's last day. A booking made before the try-on counts, so a client who books a consultation and then tries the try-on keeps it. This reads the ruling's "a client's" rather than the order of events; the brief's "books a visit while the try-on is still held" would have left that client out.
- **One per client: the oldest held when they are one.** A number may claim three try-ons a day, so keeping every one would let what R2 holds for good grow with the try-ons rather than with the clients. The owner's words name one before photo and one generated image. A migration index holds the one (`tryon_jobs_one_kept`).

**The before photo is a small copy, kept.** At the upload the site's browser also makes a copy of the photograph, re-encoded as the technician's camera re-encodes a visit photograph. The encoder is now shared, `@maneman/web-kit/small-jpeg`: a JPEG of at most 250 KB and 1600 px on its long side, with no EXIF.

- It follows the photograph on the same upload link, `PUT /api/tryon/upload/{job_id}/copy`, and only under `photo-v2` (`409 consent_required` otherwise) and only after the photograph.
- The API checks it by its bytes: a JPEG, at most 250 KB, 200 to 1600 px a side. It writes it once, to the client-photos bucket, which has no lifecycle rule, as `tryons/<job>/before.jpg`.
- A copy refused, or never made small enough, leaves the try-on as it was.
- **Unclaimed, or with no look** (a render that failed): the sweeper deletes it with the photograph, within the hour.
- **Claimed, with its look:** held as long as the look, 14 days in production and 3 on staging, and deleted with it if its person is no client by then.
- **Kept:** until the client is erased, which is also what deleting their account does. The app shows it on every visit to Photos, after the first fit too.
- The full-size photograph keeps its hour. It only feeds the render.

**The look is kept until the first fit is photographed.**

- The sweeper, on the existing five-minute cron, decides on the look's last day: a client's try-on is kept (`kept_at`), and its look moves from the results bucket, whose 30-day rule would take it, to the client-photos bucket (`tryons/<job>/look.<ext>`).
- It deletes the kept look once a photograph of the client's first-fit visit is stored, from the technician's app (ADR 0028) or from FSM (ADR 0032). It looks at the first-fit sets stored in the last three days, not at every kept look, since a look may wait for a first fit that never comes (migration 0045 indexes `photo_sets.created_at`).
- A client whose first fit is photographed already, such as a fitted client who tries the try-on again and books a service, keeps the copy alone; the look goes on its day.
- **A client who books after the look's day has neither.** The copy is held only as long as the look, so by then both are gone. Keeping the before photo for such a client would mean holding every claimed try-on's copy past its look, for everyone, which neither the notices nor the budget allow.

**The app.** `GET /api/photos` marks a client's try-on `kept`, and gives `kept_until: null` for what is kept: the photograph until they ask, the look until their first fit is photographed. The photograph is the small copy where there is one. `TryOnGroup` says so beneath the images, and after the first fit shows the before photo alone (ADR 0025, item 65; every word a placeholder). An image is still served through the client's session, and each read still takes from the result-read ceiling (ADR 0082).

**Erasure** deletes the copy and the kept look, under every key either may have (`src/domain/erasure.ts`).

**The notices, by build.** `photo-v2` and `gate-v2` say that if you book a visit, a small copy of your photograph stays in your Mane Man account as your before photo, and the look until your first fit's photographs are taken, and that both are deleted when you ask. The privacy page's try-on sentences say the same. All of it waits for counsel.

- **Production keeps `photo-v1` and `gate-v1`.** Its site build refuses an unapproved notice (`site/src/lib/publish-gate.ts`), and `test/node/site-production-gate.test.ts` holds that build passing. So production also keeps today's rules and sends no copy.
- **Every other build shows the new pair** (`TRY_ON_PROMISE`, `site/src/lib/build.ts`), with the privacy page to match. Consents on staging record them.
- **The claim records the gate's notice the page showed**, as the upload already records the photo notice's: `notice_version`, optional, the approved one when left out.
- When counsel approves the words, production moves to them in one line. If counsel changes them, they become `photo-v3` and `gate-v3`, since staging's consents already name v2.

## The budget

The copies held with their looks are counted at the upload ceiling, for the look's days and the hour before it. Moving a kept look is one read and one write. A client's kept try-on is held for good, so it is paid from Phase 2's share, as clients' photographs are. Each visit on the runway may be a new client's, bringing one kept try-on at worst (a copy of 250 KB, and a look of up to 5 MB that a client never fitted keeps for good).

|                                                      | Before       | After      |
| ---------------------------------------------------- | ------------ | ---------- |
| Try-on's R2 worst case, staging and production       | 3.28 GB      | 3.60 GB    |
| R2 storage with Phase 2's share (of 10 GB; test 80%) | 72.8%        | 76.0%      |
| R2 Class A a month, with Phase 2's share             | 10.6%        | 11.1%      |
| R2 Class B a month, with Phase 2's share             | 10.4%        | 10.4%      |
| Phase 2's photograph runway                          | 1,480 visits | 462 visits |

## Consequences

- **The runway falls to about 460 visits** while the look is kept at full size. The owner decides (`docs/open-points.md`, item 151) between:
  - keeping it at full size;
  - keeping a copy of the look as small as the before photo, which leaves 1,228 visits;
  - an outer limit on how long a look waits for a first fit.

  A small copy of the look cannot be made in the Worker, which has no image library within the free plan's 10 ms of CPU, and Cloudflare Images is barred by ADR 0009. It would be made where the before photo is: the site's result screen draws the look, and would re-encode it with the same encoder and send it with the visitor's session. It would be trusted as the before photo is: the API can check it is a small JPEG, not that it is the look, and only its owner ever sees it. A visitor who leaves before the look shows would send none, so their look would not be kept.

- **ADR 0039's table was stale.** It was worked at 6 MB a result; at today's 5 MB the try-on's worst case was 3.28 GB, 72.8% with Phase 2's share, not 79.3%. ADR 0039 is amended.
- **Each try-on under `photo-v2` writes to R2 twice**, the photograph and its copy, where ADR 0014 had one write a job. Both are counted.
- **The data export is unchanged.** It already lists each try-on's state and date (ADR 0082).
- **The teaser and the result screen still say** "Your photograph is deleted after thirty days" and "Deleted after fourteen days". They describe the try-on before any booking; counsel may want them to mention the copy (item 146).
- **Tests.**
  - `test/node/policy-kept-try-ons.test.ts`: the rule.
  - `test/node/free-tier-budget.test.ts`: the budget.
  - `test/node/migration-0045.test.ts`: the migration.
  - `test/worker/kept-try-ons.test.ts`: the copy's upload, the sweeper and erasure.
  - `test/worker/client-try-ons.test.ts`: what the app is sent.
  - `test/worker/cron-reads.test.ts`: the new sweeps read none of the history.
  - `e2e/try-flow.e2e.ts`: the site sends the copy and the new notices.
  - `e2e/app/try-on.e2e.ts`: a booked client's before photo and look, kept.
