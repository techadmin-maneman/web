# 0201. The try-on on YouCam

- Status: accepted
- Date: 2026-10-14
- Topic: The try-on
- Supersedes [0018](0018-one-look-pro-only-lead-notices.md) on the endpoint and the colour; amends [0014](0014-try-on-api.md) and [0015](0015-render-pipeline.md)

## Context

The try-on rendered with AILabTools Hairstyle Changer Pro. Pro has no "keep the colour" and defaults to blonde, so the site read each visitor's hair colour in the browser and sent it, guessing black where it could not tell; its six looks were catalogue styles chosen as rough matches for the design's words. The owner's bake-off (the harness at `Side projects\AILabTool`) compared it with YouCam (Perfect Corp) hair-transfer V2.1 in reference mode: the visitor's photograph takes the hair of a reference photograph of ours, in the visitor's own colour. With six references of one synthetic man, YouCam rendered 18 of 18 across three test photographs, about 15 s and 2 units each, and left the face below the hairline essentially untouched.

## Decision

1. **YouCam makes every look,** through `src/providers/image/youcam.ts`: the photograph uploaded through a signed URL, then a hair-transfer task with the look's reference URL and `hair_color: "src"`, polled until it succeeds or fails (docs/reference/youcam-api-notes.md). The key goes to YouCam's API host only, never to a signed URL, a log or the browser.
2. **AILabTools goes entirely.** The handoff asked for a switch back for one release; the owner chose none: a rollback is a revert.
3. **Six hairstyles, each one reference photograph:** side part, slick back, textured crop with a low fade, French crop, quiff, and crew cut (Ivy League), in that order (`src/config/presets.ts`). The domain names a look by its id alone; which reference photograph makes it is the provider's own (`src/providers/image/youcam-looks.ts`), so another vendor's catalogue entry or prompt would sit beside its adapter, not in the looks. The files are final and kept byte for byte (`data/tryon-refs-v1.json`, checked by `test/node/site/tryon-references.test.ts`); the picker shows their 512 px head-and-shoulders crops, which stop above the generator's mark on the full photographs.
4. **The references are served from production's public host,** `https://maneman.in/refs/v1/`, for staging too, since staging's site sits behind Access and YouCam must fetch them (`TRYON_REFS_URL`). They are in production's placeholder and in the site's public files, so the real site carries them at launch. A new reference changes the look, so it goes under a new version, which the cache keys on.
5. **No colour, anywhere.** The browser's colour detector is gone; the site of the release before still sends `hair_color`, which the API takes and ignores until the next release.
6. **One render for each photograph and look.** A job keeps the render it is (`render_key`: a hash of the photograph's own bytes, the look and the provider's `looksVersion`, which names the references' version and the provider); a job whose render was made before, and is still held, gets a copy of that image, and YouCam is not asked. Each job keeps its own copy, so retention and erasure stay each job's.
7. **The render's pace is YouCam's:** a poll every 2 s for the first 20 s, then every 5 s, given up at 2 minutes. A render YouCam's own model fails (`error_inference`, `unknown_internal_error`), or one that runs out of time, is made once more, and fails after the second (`RENDER_ATTEMPTS`).
8. **The page says what YouCam found wrong:** `failure_reason` beside the failure code (shoulders, face angle, no face, several people, not styleable, refused, paused), with YouCam's own code kept verbatim in `provider_error_detail`. A refused key or an empty balance pages ops (`tryon_paused`, urgent) and shows the visitor the try-on as paused; a render made clears the page. The balance is read hourly against `YOUCAM_UNIT_FLOOR`, 500 units.
9. **The photograph is prepared in the browser as YouCam takes it:** turned upright by its EXIF, drawn at most 1024 px on the long side with high-quality smoothing, a JPEG at 0.92 with no EXIF. The API takes a JPEG only.
10. **The photo notice says so:** `photo-v5` names YouCam, which keeps its copy of the photograph for thirty days. It awaits counsel's words, as `photo-v4` did.

## Consequences

- Staging renders only once production's placeholder serves `/refs/v1/`, that is from production's first release with this change.
- YouCam allows 250 requests in 5 minutes, per address and per key, shared by every visitor: a render takes about ten (an upload URL, a task, its polls), so about 25 renders in 5 minutes at most. The render ceiling (`RENDER_DAILY_CEILING`) and the hourly limits keep well under it; a 429 is tried again, backing off.
- YouCam keeps uploaded files for thirty days, under its own terms; ours go within the hour, as before.
- The columns that held AILabTools' choice (`hair_color`, `endpoint`, `provider_color`, `color_route`) are no longer written, and go in a later contract step (docs/migrations.md).
- Hair-transfer documents no webhook, so it is polled.
- Tests: `test/worker/vendors/youcam.test.ts`, `test/worker/vendors/render.test.ts`, `test/node/site/tryon-references.test.ts`.
