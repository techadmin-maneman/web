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
- **One event at a time, oldest first.** A job's writes therefore reach the API in the order the technician made them. ~~And so reach FSM in that order.~~ **Corrected 25 September 2026:** they did not. The API put each on the fsm-sync queue as its own message, and a retried one was overtaken by the steps behind it; the audit saw a job completed in FSM 35 seconds before its after photographs were attached. From ADR 0065 each write waits for the job's earlier ones, and one given up on holds back everything after it.
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
- **iOS may evict the store.** The prompt asks for company Android phones for this reason; it is `docs/open-points.md`'s item 124.
- **The app follows the API, not the boards.** `npm run openapi` writes `apps/tech/src/api-schema.ts` from the schemas that serve the routes, and `apps/tech/src/routes.ts` assumes nothing. What the boards draw and the API cannot answer — a job's distance from the technician, and the piece card's tier, colour, adhesive, template and scalp — is recorded beside the fidelity pairs in `docs/fidelity-method.md`. The "Free" badge was on that list until 25 September 2026, when the API began answering it (ADR 0065); a job's slots, the client's pieces, the last visit's after photograph and the day-before WhatsApp's delivery receipt left it the same day ("The job flow", below).
- **The check-in is queued like every other write, and its answer is kept.** It is the one write whose answer a screen needs: how far the phone was from the door, and when the no-show wait ends. Both are kept beside the job (`apps/tech/src/store/jobs.ts`), so a reload does not lose the countdown. A check-in queued in a basement says so, and the check runs when there is signal. From ADR 0065 the job's card carries both as well, in its `progress`, so a phone that lost its copy — a second store on an iPhone, a sign-out, a loaner — can still close a no-show.
- **The close-out's duration is the phone's.** It runs from the `started_at` the API keeps to the instant the technician took the outcome, because nothing gives the closing time back.

---

## Update, 24 September 2026: the phones are any phones, and one of them is an iPhone

The owner ruled open point 124:

> Any phone, including iPhones.

The decision above assumed the opposite. "The prompt asks for company Android phones for this reason; it is `docs/open-points.md`'s item 124" was the whole of this ADR's answer to eviction, and it is now no answer at all. Three things in the app followed from the assumption, and this section records what each becomes. The Navigate link is the fourth and is ADR 0054's, which had already written the replacement.

### The home screen is where an iPhone keeps this store, so the app is installable

An iPhone does not treat an installed web app as a bookmark. It is a separate copy of the app with its own cookie jar, its own IndexedDB, its own service worker — and, the part that matters here, its own standing with the storage policy.

Two things Apple has published decide the design:

- **The seven-day cap.** WebKit deletes "Indexed DB, LocalStorage, Media keys, SessionStorage, Service Worker registrations and cache" after seven days of Safari use without interaction with the site. And, in the same post: web applications added to the home screen "have their own counter of days of use… Their days of use will match actual use of the web application which resets the timer. We do not expect the first-party in such a web application to have its website data deleted" (webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/).
- **What earns persistent storage.** "By default, all origins use a best-effort mode, which means their persistence is not guaranteed and their data can be evicted"; an origin escapes eviction only if "it has active page at the time of eviction, or its storage is in persistent mode"; and WebKit "currently grants a request based on heuristics like whether the website is opened as a Home Screen Web App" (webkit.org/blog/14403/updates-to-storage-policy/). The eviction order is least-recently-used, where "the last use time is the time of the last user interaction, or the time of the last storage operation".

So installing to the home screen is not a convenience on an iPhone. It is the difference between a store Safari may clear after a quiet week and one it is not expected to, and it is the thing that makes `navigator.storage.persist()` likely to be granted at all. The app had neither manifest nor icons — "it is opened from a link ops send, not installed from a store" — and a home-screen shortcut without `display: standalone` opens in Safari and buys none of this. **`apps/tech/sw-build.ts` now emits a manifest and the icons, and `apps/tech/index.html` links them**, on the client app's pattern (`apps/app/pwa.ts`). Since 5 October 2026 both apps share one build (`packages/web-kit/pwa.ts`), the technician app's identity in `apps/tech/pwa.ts`: "MM Tech" under its icon, held upright. `docs/tech-field-test.md` asks the technician to install it as the first step of the iPhone pass.

### An installed app is signed out, and the app says so

The cost of installing is a second sign-in: the installed copy's cookie jar is empty, `GET /tech/me` answers `401 session_required`, and a technician who signed in an hour ago is looking at a sign-in screen. ADR 0029 named this ("An installed iOS web app has its own cookie store") and left it there.

The app now tells the three cases apart. `App` reads whether this store had ever held a session **before** it wipes, so the sign-in knows whether it is showing because ops revoked the phone, because a session ended, or because this store has never had one. A store that has never had one, in an app running standalone, is the installed copy and nothing else, and the sign-in says so in the app's own words (`apps/tech/src/content.ts`). A first sign-in in a browser says nothing extra, because nothing has happened that needs explaining.

### The old device row is left, not revoked and not merged

A second cookie jar means a second `device_id` and a second `technician_devices` row: one handset, two rows.

- **Not merged.** A device row names one storage container — one thing ops can revoke, and one thing `wiped_at` records the wiping of. Two containers genuinely exist. Merging them would let a revoke clear one and claim both, and would leave the browser copy holding a client's name, mobile and address with no row left to revoke it by. That is the opposite of what the revoke is for (ADR 0031).
- **Not revoked automatically.** Nothing tells us the two rows are one handset. The device ID is the app's own, from its storage, "never a hardware serial" (ADR 0052), and the app fingerprints nothing on purpose. The only signal available is that the same technician signed in somewhere else — which is also exactly what a loaner phone looks like, and revoking on that signal would wipe the phone he is holding. Worse, a revoke wipes the store, and the browser copy may still be carrying a check-in and two photograph sets that never went up. Automatically revoking would turn a second sign-in into lost evidence, which is the failure this whole section exists to prevent.
- **Left.** Each row keeps its own session, 90 days from last use, and ops revoke by hand from board D3 when a phone goes. The price is that a technician who installs the app has two rows for one handset until the browser copy's session lapses. It is paid openly: the sign-in says the browser copy is still signed in and still holding whatever it has not sent, and the field test has ops look at both rows.

### The phone is asked to keep the store, and told to say so when it will not

`apps/tech/src/store/persist.ts` asks `navigator.storage.persist()` once per store, after a session is established, and keeps the answer beside the device ID — so a wipe takes it too, which is right: the installed app and the browser it was installed from are two stores, and one's answer says nothing about the other's.

When the answer is no, or the browser has no `StorageManager` to ask, the technician is told — but only while there is something in the outbox, because the warning is about that queue and not about the phone. Today carries the line beneath what is waiting, and `/waiting` carries it above the list along with **how long** each job's oldest unsent thing has been on the phone. Nothing is hidden and nothing is dramatised: the remedy is to get to signal and let the queue empty, and that is what the words say.

Beside it, the outbox is now replayed whenever the app comes to the front, not only when `online` fires. iOS is unreliable about that event, and a phone that found signal in a pocket has no other moment to notice. The less time a job spends only on the phone, the less of it an eviction can take.

### What could not be established from a desk

`playwright.config.ts` gains a `tech-ios` project on WebKit, and `e2e/tech/ios.e2e.ts` runs the app on it. **WebKit in Playwright is the engine an iPhone runs and it is not Safari on iOS**: no Intelligent Tracking Prevention, no seven-day cap, no Home Screen Web Apps, and no reason for its answers about storage to match Safari's. What it proves is that nothing in this app is Chromium-only. Measured there on 24 September 2026, for the record rather than as a claim about any iPhone: `navigator.storage.persist()` answered **false**, `persisted()` stayed false, and the quota was **1,000 MB** — the same order as Safari's own per-origin quota. Headless Chromium answered false as well, on its own heuristics.

What no desk can settle, and what `docs/tech-field-test.md`'s iPhone pass asks: whether a real iPhone grants persistence once the app is on the home screen; whether an installed app's store survives a week of not being opened; whether `getUserMedia` gives ten usable frames through iOS's own camera pipeline; and whether the installed app keeps its session across an iOS update. Until those are answered, an iPhone is a phone the app degrades safely on, not a phone the offline outbox is proven on.

---

## Update, 25 September 2026: what the phone keeps, when the session ends, and a signal that never answers

The audit of 24 September found the decision above stated and not kept in six places. This section records what each now does.

### A 401 from any call ends the session

"A 401 is the end of the session, whatever caused it" held for one call: `GET /tech/me`, asked when the app opened and when it came back online. Every other call treated a 401 as no signal, and the day's list and each card fell back to what the phone held — so a phone revoked with the app open went on showing a client's name, address and gate code. The outbox noticed the 401 and told no one.

Now `apps/tech/src/api.ts` tells App of any 401, from any call, and App hides the screens, wipes the database and shows the sign-in, wherever the technician was. The screens fall back to the phone's copy only when the API could not be reached — no signal, a 429 or a 5xx. Any other answer is the API's word: a 401 has ended the session, and a 404 says the job is not this technician's. The first 401 a revoked phone meets carries `device_revoked`, so it now says it was revoked, where before it usually said only that the session had ended.

### The phone keeps two days and no more

The cards and day lists were written and never deleted, so a phone held every card it had opened for as long as its 90-day session. Now, each time a day arrives fresh from the API, the phone lets go of everything but today's and tomorrow's lists, the cards and check-ins of the jobs in them, and any job whose work has not reached us (`forgetOld` in `apps/tech/src/store/jobs.ts`). The service worker keeps today's list alone, dropping the earlier day's as it keeps the new one. `docs/open-points.md`'s item 55 now describes this.

### Sign out asks first, and needs signal

One tap on Sign out wiped the phone, unsent photographs and all, and with no signal the API never heard: the phone came back signed in when the signal did, with nothing on it. Now Sign out, with work still on the phone, says how much and offers **Send first**. And the phone is wiped only once the API has ended the session: with no signal it keeps everything and says the technician is still signed in.

### The sign-in always has a way on

Once a code was sent the number was locked, and a closed code said "Ask for another" with nothing to ask with — a dead end in an installed app, which has no reload button. Now **Change number** is there from the moment a code goes out, **Send a new code** 30 seconds after, and a closed code (a `410`, or no tries left) takes the screen back to sending one.

### A weak signal opens the app from the phone

The service worker served every page network-first, with no limit, so a signal that never answered held the app closed while one that was plainly off opened it at once. Now the shell comes from the kept copy first. A new build still arrives: the browser checks for a new `sw.js` each time the app opens, the new worker keeps its own shell and drops this one, and the next open is the new app. Racing the network against a timeout, with navigation preload, was the other way; it keeps a fresher shell on a good signal at the price of a wait on every weak one, and a technician in a basement is the case this app exists for.

Every call now gives up too: after 4 seconds for a read the phone holds its own copy of, 15 for a write or a sign-in, and 60 for a photograph. An answer that is not JSON — a Wi-Fi sign-in page, say — counts as no signal rather than leaving a screen loading. And whether the phone has signal is now what the last call found, not only what the phone says, so "No signal · working offline" shows when nothing answers on a network the phone believes in, and the day the service worker answered from its copy (`Mm-Served-From: cache`) shows as offline too.

The worker no longer keeps the extended-Latin fonts or the rupee, which the app never draws with, and `scripts/build-tech.ts` counts `sw.js` in the 150 KB budget.

### The store survives other tabs, new builds and a full phone

- **Upgrades run step by step** (`UPGRADES` in `apps/tech/src/store/db.ts`), from whatever version a phone last had, and every record carries the version of its shape as `v`, so a later build can tell what it must move.
- **A connection lets go when asked.** Another tab, a newer build or the app's own wipe no longer waits on it; a wipe held up by an older build's tab waits three seconds, then lets the sign-in show while the browser finishes the delete.
- **A write settles when it commits**, not when it is queued, and one the phone has no room for fails as "storage full": App says so above every screen until a write to the same store lands.
- **A store that will not open is tried again** on the next call, and no screen waits for ever on one.

### The camera and a screen that fails

The camera is let go while the app is hidden and opened again when it comes back, and opened again when its track ends; a refused camera offers **Try again**; and a frame that did not keep says so and can be taken again, where before any failure left "camera unavailable" for good. A screen that throws while it draws shows a line and **Reload** instead of a blank page, and the reload loses nothing: the outbox and the frames are in IndexedDB, not in the page.

### Consequences

- The store and the sending have their own tests, on an IndexedDB that runs in Node (`fake-indexeddb`): `test/node/tech-store.test.ts`, `tech-kept.test.ts`, `tech-outbox-replay.test.ts`, `tech-api.test.ts` and `tech-sw.test.ts`. The browser walks each change in `e2e/tech/`.
- The words for the states no board draws are placeholders in `apps/tech/src/content.ts`, for the owner (`docs/open-points.md`, item 42; ADR 0025, item 32).

---

## Update, 25 September 2026: the job flow

The audit of 24 September walked the job at the door and in the steps and found work lost or doubled, a charge one unconfirmed tap away, and a technician told what changed only on a screen he had no reason to open. This section records what each became. Where it departs from a board, ADR 0025's "The technician boards" says so for the owner.

### One tap, one write

- **The outbox queues a step once.** A step already waiting for its job is not queued again, whichever screen asks, so a gloved double tap on Start job or Next sends one write (`queue` in `apps/tech/src/store/outbox.ts`). The screens run each action one at a time as well (`apps/tech/src/lib/useOneAtATime.ts`, the client app's own).
- **A step takes no tap while it is sliding in.** A double tap's second tap lands on the screen the first one opened, where the next step's action sits in the same place; for its first 350 ms a step's action ignores it (`useSettled`, `apps/tech/src/steps/StepFrame.tsx`).
- **A photograph is kept by its angle.** A frame's key is its job, phase and angle, so a second frame for one angle replaces the first rather than standing in for the next: the API keeps one photograph per angle, and a set that had two of one had none of another.

### What changed reaches every screen

- **Every write carries the job's start as the card gave it** (`X-Job-Starts-At`), so a job ops moved to another time is superseded like one given to someone else (ADR 0065).
- **A 404 on the way to a write is the job moving, not a failure.** The API answers 404 to a photograph's PUT, or to an upload link for a job that never was this technician's; the outbox stops that job as superseded, and the screens say "This job is no longer on your list", never "The photographs would not upload". Since 28 September 2026 an upload link for a job that was his, and was given to another technician or cancelled while its photographs waited, answers `409 superseded` as a write does, naming whom it went to (`docs/open-points.md`, item 92), and the screens say "Ops moved this job to Sameer at 10:40 am." The photographs stay on the phone until he has read it and chosen to delete them.
- **What stopped a job is said above every screen**, not only on the waiting screen, and across the job's card, which then offers nothing to press on with. The 409 names the fields that moved and never their values; once the card is fetched again it carries the new time, and the card then says "Ops moved this job to 11:30 am" rather than only that it moved. A job given to another technician says whom and when, "Ops moved this job to Sameer at 10:40 am.", from the 409's `moved` (the owner's ruling of 27 September 2026, `docs/open-points.md`, item 92).
- **"Got it" asks before it deletes.** It lets go of the job's photographs and writes, which never reach us, so it says how many and asks a second time.
- **A step the API refused is put right, not only thrown away.** "Correct it" opens the step again with the refusal said; finishing it sends the corrected step in the place the refused one had, under a new event ID, since the API recorded nothing of the refused one, and the steps queued behind it follow (`correct`).

### The door

- **The stage decides what the card offers** (`stageOf`, `apps/tech/src/lib/progress.ts`): nothing on a job ops changed; its next step and nothing of the door's once it has started; "Closed out" and no gold once it has closed; no check-in on tomorrow's unlocked card, which now carries its day. The stage's one action sits at the foot.
- **The wait runs whether or not the phone kept its copy.** The card carries the wait's end and the distance the API holds, so a phone that lost its own check-in — a second store on an iPhone, a sign-out, a loaner — counts the wait and closes the no-show. With no signal the wait counts from the tap, and the close waits for signal, because the API holds the wait on its own clock too (ADR 0065).
- **Close as no-show asks first.** It is outlined, never gold, and a sheet says "Ops may charge the client" before anything is sent. A no-show the API refuses as early is said on the card, and the close-out never reads "done" for a job that is not closed; a no-show's close-out is board B5's evidence summary.

### The steps

- **The piece's label is checked on the phone** with the API's own pattern, a space taken for the hyphen it means, so a label the API would refuse is caught where it can be put right. A lookup with no signal says so, rather than that the label is unknown; another client's piece keeps Next dim. The step takes the new piece's base and supplier lot, and on a replacement the piece that came off and why it failed, which the pieces tab reads; "Pick from the list" offers the client's pieces the card now carries.
- **The outcome starts with nothing chosen.**
- **Board B1's framing guide is drawn over the camera**, and Capture sits at the foot beside Retake and finishes the step once the five are in.
- **Each screen names itself in the title and takes the focus to its heading when it opens**; a count or a capture is said as it changes.

### The small routes the card needed

Board A3's piece card and last visit's photograph, board B3's "Pick from the list" and board B5's delivery receipt were recorded above as things the API could not answer. They are now fields of the card itself, so the phone keeps them with it for the basement, rather than routes of their own: `pieces` (the client's, newest fit first), `last_visit` (its date and technician), `reminder` (the day-before WhatsApp's delivery) and `no_show_wait_min`. The day's list carries each visit's `slots`. The one new route is the photograph, `GET /api/tech/jobs/{id}/last-visit-photo`: under the card's own unlock, to this job's technician alone, and answered `private, no-store`, so neither the browser nor the service worker keeps a client's photograph on a technician's phone.

### Consequences

- `test/node/tech-progress.test.ts`, `tech-when.test.ts`, `tech-piece-label.test.ts` and new cases in `tech-outbox-replay.test.ts` hold the rules above; `test/node/tech-contrast.test.ts` holds the colours; `test/worker/tech-job-card.test.ts` the card's new fields and the photograph's route; `e2e/tech/job.e2e.ts`, `steps.e2e.ts`, `camera.e2e.ts` and `outbox.e2e.ts` walk them in a browser.
- The words for what no board draws are placeholders in `apps/tech/src/content.ts`, for the owner with the rest (ADR 0025, "The technician boards").

## Update, 4 October 2026: the day's list names the client

From the day before the visit, when a job unlocks, the day's list carries the client's name (`client_name`), as the card does, so Today names each row without waiting for the cards. The service worker's copy of today's list now holds those names. It holds nothing the phone's store does not already hold in the cards it keeps, and it is deleted with the store at sign-out and on revocation. The service worker still keeps no card, so no mobile, address or gate code.
