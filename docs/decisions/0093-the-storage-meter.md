# 0093. The storage meter, the photograph upload limit, and thumbnails made on the phone

- Status: accepted, on the owner's rulings of 27 September 2026 (`docs/owner-answers-2026-09-27.md`: items 66 and 151). Departs from [0039](0039-phase-2-budget.md), which planned to refuse uploads when the share filled, and from [0009](0009-stay-inside-cloudflare-free-tier.md)'s "the card on the account is never charged", for R2 storage alone
- Date: 2026-09-28
- Amends [0028](0028-photographs-from-the-app.md), [0039](0039-phase-2-budget.md) and [0084](0084-a-clients-try-on-is-kept.md); follows [0067](0067-alerts-and-silent-failures.md)

## Context

ADR 0039 gave Phase 2's photographs and referral cards 4 GB of R2's free 10 GB. It planned a meter that warned ops at 50% and 80% of that share and refused uploads at 100%, leaving photographs queued on the phones. None of it was built (`docs/open-points.md`, item 142). Three more things were open:

- **The upload limit.** `PUT /api/tech/photos/:token` took up to 12 MB, where the app sends about 250 KB (item 143). One misused link could spend what fifty real photographs do.
- **Thumbnails.** The client app's Photos rows show each photograph about 65 px wide, and there was no smaller copy to fetch, so every row downloaded whole photographs (item 66).
- **Erasure and retakes.** A photograph taken again at the same angle stays in the bucket, under the visit's prefix, "for an erasure to find" (ADR 0028). Erasure only deleted the keys the rows named, so it never found them.

The owner ruled on two of these on 27 September 2026:

> **66.** "the phone makes the thumbnail … the technician app writes a small copy beside each photograph at capture and uploads both; the client app shows the small copy in each row."
>
> **151.** "keep the look at full size and pay for R2 beyond the free tier when it fills … the storage meter (item 142) warns ops at 50% and 80% of the share, and R2's paid storage is accepted as the share fills."

## Decision

**The meter is one running figure in D1** (`storage_meter`, migration 0055; `src/domain/storage-meter.ts`).

- It counts what the two Phase 2 buckets hold: `client-photos` (visit photographs, their thumbnails, a try-on's small copy and a client's kept look) and `referral-cards`.
- Every write to and delete from those buckets goes through `putCounted`, `deleteCounted` or `deleteAllUnder`, which add or take off the object's size.
- A delete must know what it freed, since R2's delete does not say. `deleteCounted` reads each key's size first, with `head`, a Class B read; the sweeper's deletes come in batches of at most 100. An erasure lists each of the person's visits instead, whose listing gives every object's size: one list and one delete a visit, however many photographs it holds, so a long-standing client's erasure stays well inside the 1,000 calls to Cloudflare's services one invocation may make.
- It is never read by listing a bucket. Listing is a Class A operation, and the cron runs 288 times a day.
- **The backfill** (migration 0055):
  - a photograph counts at the size its row records;
  - a referral card counts at 300 KB, a try-on's small copy at 250 KB, and a kept look at 5 MB. These are their upload limits, since no row records their sizes, so the figure starts high rather than low;
  - a photograph that was replaced is in no row, so the figure starts below the bucket. The runbook says how to true it up.

**Ops are told once at 50%, 80% and 100% of the share** (`src/policy/storage-share.ts`, which quotes the owner). A cron job, `storage_meter`, reads the one row each run and raises a kept alert (ADR 0067), `r2_share:50`, `r2_share:80` or `r2_share:100`, linking to Settings. The last mark told is kept on the row, so each mark is told once for good, and a run that finds two passed tells only the higher. Settings shows the figure in one line above its tabs (`GET /api/storage`).

**At 100%, nothing is refused.** ADR 0039 planned to refuse uploads there, and ADR 0009 allows no charge at all. The owner accepted R2's paid storage as the share fills (item 151), so a full share is told and uploads go on. This departs from both ADRs for R2 storage alone. Every other allowance still fails closed rather than bills.

**One ceiling stops a runaway: 20 GB** (`RUNAWAY_CEILING_BYTES`).

- It is twice R2's free allowance and five times the share. A business that reaches it has been told three times on the way.
- A broken build or a misused upload link that ran to it would cost about $0.20 a month in storage, at R2's $0.015 a GB-month past the free 10 GB.
- Past it, the technician app's photograph and thumbnail uploads answer `503 busy`, and ops are alerted. The phone reads a 503 as no signal, so it keeps the frames and sends them again later.
- Only the technician's uploads check it. They are the one path a phone can repeat without limit. The try-on's writes have their own daily ceilings (ADR 0009), a referral card replaces the one before it, and a photograph from FSM is written once per attachment.

**A photograph from the technician app is at most 2 MB** (`MAX_PHOTO_BYTES`, was 12 MB).

- The app sends about 250 KB. When a frame will not come down to that, it sends the smallest it tried: 900 px on its long side at its lowest quality, well under 1 MB even from a phone that ignores the quality it is asked for. 2 MB is twice that.
- **A photograph copied from FSM** keeps FSM's size (item 125). It takes its own path, the mirror's export (`src/domain/visit-photos.ts`), which has no limit of its own and is counted like any other.

**The phone makes a thumbnail of each photograph at capture.**

- The camera holds one still of the frame (`still`, `@maneman/web-kit/small-jpeg`) and encodes two JPEGs from it: the photograph as before, and a thumbnail, `thumbnailJpeg`.
- The thumbnail is 300 px on its short side, never larger than the frame, encoded to about 32 KB.
- The client app's row cell is about 65 to 73 px wide and 87 to 97 px tall on a phone, and 300 px on the short side fills it at three device pixels to one, whatever the photograph's shape.

**The phone keeps the pair in its outbox and uploads both.**

- **The photograph always goes first,** then the thumbnail, to `PUT /api/tech/photos/{token}/small`, which the upload link's answer names (`small_upload_url`).
- **A photograph that is up is marked so** (`photo_sent`). A round cut off before its thumbnail sends only the thumbnail the next time, and does not store the photograph twice.
- **A thumbnail the API refuses is let go.** The client app then shows the photograph itself.
- **A frame kept before this build** has no thumbnail, and goes without one.

**The API keeps the thumbnail beside its photograph** (`src/domain/tech-photos.ts`).

- **What it takes:** a JPEG of at most 64 KB and 800 px a side (`MAX_THUMBNAIL_BYTES`).
- **Where it goes:** `visits/<appointment>/<phase>-<angle>-<uuid>-small.jpg`, in the same bucket and under the same prefix as the photograph. The photograph's row names it in `photos.thumbnail_key`.
- **A thumbnail is never held without its photograph.** Before the photograph arrives, the thumbnail's upload answers `409 upload_missing`. Once the photograph has one, a second copy is answered 204 and not stored again.
- **A retake forgets the old thumbnail.** A photograph taken again at the same angle, in the app or in FSM, clears `thumbnail_key`, so a row never shows another take's thumbnail. The old thumbnail stays in the bucket with the old photograph, as ADR 0028 has it.

**The client app shows the thumbnail in its rows.**

- `PhotoLink` carries `thumbnail_url`, a link that lasts 15 minutes, signed for its own purpose (`photo_small`) and checked against the session as the photograph's is.
- A photograph with no thumbnail, such as one copied from FSM or taken before this build, has `thumbnail_url: null`. Its row shows the photograph itself, fetched only as it nears the screen, as before.
- The opened sheet, the compare and the download use the whole photograph.
- If a thumbnail the row names is missing from the bucket, its link answers with the photograph itself, so a row never shows a broken image.

**Erasure deletes everything under each of the person's visits** (`deleteAllUnder`): their photographs, any taken again, and every thumbnail. Before this, a retake stayed in the bucket after the client was erased. Nothing else deletes a visit photograph: the bucket has no lifecycle rule, and neither the sweeper nor any retention rule touches `visits/`.

## The budget

Each visit's ten photographs now bring ten thumbnails, counted at 32 KB each (`THUMBNAIL_BYTES`, `scripts/lib/free-tier-budget.ts`). Phase 2's share is the policy's own figure (`PHASE_2_SHARE_BYTES`), so the budget and the meter cannot disagree.

|                                                      | Before       | After        |
| ---------------------------------------------------- | ------------ | ------------ |
| Photograph runway, each visit with a kept try-on     | 462 visits   | 444 visits   |
| Photograph runway, no try-on kept                    | 1,480 visits | 1,312 visits |
| Photograph runway, the look kept as small as a photo | 1,228 visits | 1,110 visits |

Past the runway, R2 bills on the owner's ruling; the runway is now when ops are told at 100%, not when anything stops.

## Consequences

- **Ops hear of the share at 2 GB, 3.2 GB and 4 GB**, once each, and see the figure in Settings. Cloudflare's own usage notification at half of R2's 10 GB stays as the backstop (runbook, "R2 storage growing").
- **Each environment's meter counts its own buckets** against the whole share, which staging and production share on one account. Staging holds little, and the runbook says to read both buckets on the dashboard before trusting one figure.
- **The figure can drift from the bucket.** An object written outside these helpers is not counted, and nor is a write whose D1 update failed after R2 took it. The runbook compares the figure with the bucket sizes on the dashboard, and says how to set it.
- **Each mark is told once for good.** A figure that falls back below a mark, after an erasure or a correction, and passes it again is not told again. Resetting `told_percent` on the row makes the meter tell again.
- **A thumbnail is one more R2 write for each photograph,** and a delete is one Class B read for each object before the Class A delete. Both fit well inside Phase 2's operations shares (ADR 0039).
- **Tests.**
  - `test/node/policy-storage-share.test.ts`: the marks and the ceiling.
  - `test/node/migration-0055.test.ts`: the backfill.
  - `test/worker/storage-meter.test.ts`: the counting and the alerts.
  - `test/worker/field-operations.test.ts`: the upload limit, the ceiling and the thumbnail's upload.
  - `test/worker/client-visits.test.ts`: the thumbnail's link and its fallback.
  - `test/worker/erasure.test.ts`: retakes and thumbnails erased.
  - `test/worker/visit-photos.test.ts`: FSM's size, and a retake from FSM.
  - `test/worker/ops-storage.test.ts`: the console's figure.
  - `test/worker/cron.test.ts`: the job.
  - `test/node/tech-outbox-replay.test.ts`: the pair in the outbox.
  - `e2e/tech/camera.e2e.ts`: the capture and the upload of both.
  - `e2e/app/fitted.e2e.ts`: a row's thumbnail and its fallback.
  - `e2e/ops/settings.e2e.ts`: the line in Settings.
