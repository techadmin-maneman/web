# 0038. The technician app offline: the outbox, the device and the camera

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
- **A `409 superseded` stops that job and nothing else.** The event keeps the API's own words, the screen shows them ("Ops moved this job to Sandeep at 10:40"), and the job's remaining events wait. Every other job's queue goes on, so a close-out ops superseded cannot strand the next visit.
- **A 429 or a 5xx stops the whole round**, to be tried again; any other refusal stops that job with the reason. Nothing is merged silently and nothing is dropped.
- **The screens account for it plainly**: the day's list carries a line for what is waiting, and `/waiting` gives one row per job with its photo sets, its queued actions, and what changed.

**The device enrols itself.** The phone makes a UUIDv7 for itself the first time it is asked, sends it when the technician signs in, and the backend binds the session to it. The device's _label_ is the server's, from the User-Agent at sign-in, as ADR 0029 has it; the app never sends one. The ID lives in the wiped database, so a revoked device does not revive its enrolment: the next sign-in enrols a new one.

**A 401 is the end of the session, whatever caused it.** The app wipes the database and returns to the sign-in. A `device_revoked` code changes only what it says.

**Photographs come from `getUserMedia` into a canvas** (`apps/tech/src/camera/capture.ts`), never from a file input with `capture`, which on some phones writes to the camera roll. The canvas re-encodes each frame as JPEG, which leaves no metadata of the original behind, stepping the quality down and then the frame itself until it is at or under **250 KB**, the size ADR 0039's R2 budget assumes for each of a visit's ten photographs. Each frame goes into the `frames` store and is deleted when the upload is confirmed.

**No service worker yet.** The client app's caches the shell (ADR 0043); this app's offline working is its own store. Until the shell is cached too, an app reloaded with no signal is a blank page — a technician's phone keeps the app open through a job, so this is a gap to close at the field test, not a fault in the day's work.

## Consequences

- **The rules can be read.** `apps/tech/src/store/replay.ts` holds the ordering and the stopping, with no IndexedDB in it, and `test/node/tech-outbox.test.ts` checks them. `e2e/tech/outbox.e2e.ts` walks the whole thing in a browser: a start queued with no signal, replayed on reconnection, and a supersede that says what changed.
- **iOS may evict the store.** The prompt asks for company Android phones for this reason; it is `docs/open-points.md`'s item for P2-M4.
- **The routes are provisional.** P2-M4's API is being built beside this app, so `apps/tech/src/routes.ts` names every route as the backend prompt writes it and declares the two it does not (`GET /tech/me`, `POST /tech/auth/logout`). `test/node/tech-routes.test.ts` checks the list against the prompt until `docs/openapi-tech.json` exists and the types are generated.
- **The six in-job steps are not built.** Step 1's capture is, because the camera is this app's alone; the checklist, consumables, piece, after set and outcome wait for the job sheet and the routes that carry them.
