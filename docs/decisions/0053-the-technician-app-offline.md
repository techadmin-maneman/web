# 0053. The technician app offline: the outbox, the device and the camera

- Status: accepted
- Date: 2026-09-23

## Context

The technician app (`tech.maneman.in`, the Worker `mm-tech`) is used in basements with no signal, in direct sun, with adhesive on the gloves. `design/phase2/Technician App.dc.html` and the front-end prompt ask for three things the other Phase 2 surfaces do not need:

- **Offline first.** "Today's and tomorrow's jobs and client cards are cached… Every action is queued with a client-generated event ID and replayed in order when the phone is back online. A `409 superseded` from the backend shows what changed… It never shows a generic error."
- **A session bound to the device.** "The session can be revoked from ops. On revocation, the app wipes its IndexedDB and signs out at its next contact with the backend" (ADR 0029).
- **Photographs that never touch the phone's gallery.** "Capture through `getUserMedia` into a canvas, not through a file input that may save to the camera roll… Hold the frames in IndexedDB… Re-encode to JPEG so no metadata survives."

The owner ruled on 23 September 2026 that we build our own interface over FSM (`docs/decisions/fsm-licensing.md`), so this is what technicians use.

## Decision

**One IndexedDB database, `mm-tech`, holds everything the phone keeps** (`apps/tech/src/store/db.ts`): the device's ID, the day's jobs and cards, the outbox, and photograph frames. It is app-private, and it is wiped whole — not emptied store by store — at sign-out and on revocation.

**The outbox is the only way a write leaves a screen.** A screen queues an event and moves on; the phone sends it when it can.

- **Each event carries a UUIDv7**, sent as the `X-Client-Event-Id` the backend makes the write idempotent on. Version 7 puts 48 bits of milliseconds first, so a queue reads in the order it happened.
- **Order comes from the store's own key, not from the ID.** Two events queued in the same millisecond have no order in a UUIDv7, so the `outbox` store keys itself with an auto-incrementing number and is replayed in that order (`apps/tech/src/store/replay.ts`).
- **One event at a time, oldest first.** A job's writes therefore reach FSM in the order the technician made them.
- **A `409` stops that job and nothing else.** The API answers a code and, on a supersede, the fields that moved — `technician`, `status` — and never a sentence, so the event keeps both and the screen says which one changed in the app's own words (`apps/tech/src/content.ts`). `out_of_order` stops a job the same way, because the queue is ordered and a step out of it is a fault worth showing. Every other job's queue goes on, so a close-out ops superseded cannot strand the next visit.
- **A 429 or a 5xx stops the whole round**, to be tried again; any other refusal stops that job with the reason. A `425 too_early_to_close` is the one exception: the no-show wait has not run, nothing is wrong with the job, so the event is dropped and the countdown goes on. Nothing is merged silently and nothing is dropped otherwise.
- **A photograph set is not one call.** Replaying `before_photos` or `after_photos` first asks for an upload link per angle and PUTs the frame to it, dropping each frame as it lands, and only then sends the set. A round interrupted halfway therefore sends nothing twice.
- **The screens account for it plainly**: the day's list carries a line for what is waiting, and `/waiting` gives one row per job with its photo sets, its queued actions, and what changed.

**The device enrols itself.** The phone makes a UUIDv7 for itself the first time it is asked, sends it when the technician signs in, and the backend binds the session to it. The device's _label_ is the server's, from the User-Agent at sign-in, as ADR 0029 has it; the app never sends one. The ID lives in the wiped database, so a revoked device does not revive its enrolment: the next sign-in enrols a new one.

**A 401 is the end of the session, whatever caused it.** The app wipes the database and returns to the sign-in. A `device_revoked` code changes only what it says.

**Photographs come from `getUserMedia` into a canvas** (`apps/tech/src/camera/capture.ts`), never from a file input with `capture`, which on some phones writes to the camera roll. The canvas re-encodes each frame as JPEG, which leaves no metadata of the original behind, stepping the quality down and then the frame itself until it is at or under **250 KB**, the size ADR 0039's R2 budget assumes for each of a visit's ten photographs. Each frame goes into the `frames` store and is deleted when the upload is confirmed.

**A service worker keeps the shell, and one API answer.** `apps/tech/sw/sw.ts` precaches every file of the build, with the app itself kept as `/`, so a phone in a basement can close the app and open it again. Beside it, one cache holds the answer to `GET /api/tech/jobs?date=<today in India>` and nothing else: that answer carries a time, a type, a badge and an area, and no client at all. **A job's card is never cached** — it carries the client's name, mobile and address — nor is `GET /tech/me`, nor a piece, nor a photograph going up or coming down. The day cache is deleted with the database at sign-out and on revocation, so a phone that is no longer ours keeps none of a technician's day either.

## Consequences

- **The rules can be read.** `apps/tech/src/store/replay.ts` holds the ordering and the stopping, with no IndexedDB in it, and `test/node/tech-outbox.test.ts` checks them. `e2e/tech/outbox.e2e.ts` walks the whole thing in a browser: a step queued with no signal, replayed on reconnection, and a supersede that says what changed.
- **iOS may evict the store.** The prompt asks for company Android phones for this reason; it is `docs/open-points.md`'s item 27.
- **The app follows the API, not the boards.** `npm run openapi` writes `apps/tech/src/api-schema.ts` from the schemas that serve the routes, and `apps/tech/src/routes.ts` assumes nothing. What the boards draw and the API cannot answer — a job's slots, its distance, a "Free" badge, a piece card on the job, last visit's photograph, the day-before WhatsApp's delivery receipt — is recorded beside the fidelity pairs in `docs/fidelity-method.md`.
- **The check-in is queued like every other write, and its answer is kept.** It is the one write whose answer a screen needs: how far the phone was from the door, and when the no-show wait ends. Both are kept beside the job (`apps/tech/src/store/jobs.ts`), so a reload does not lose the countdown. A check-in queued in a basement says so, and the check runs when there is signal.
- **The close-out's duration is the phone's.** It runs from the `started_at` the API keeps to the instant the technician took the outcome, because nothing gives the closing time back.
