# Verification

What each milestone's definition of done required, how it was checked, and the result.

## M1: skeleton, environments, pipeline

Checked on 21 September 2026 on Windows 11, Node 24.18 and wrangler 4.135.0, against the live Cloudflare account, and in GitHub Actions on PR #1.

My network's DNS resolver still cached GoDaddy's old addresses for `maneman.in` that day. The remote smoke runs therefore sent `*.maneman.in` to Cloudflare's edge (`104.21.84.97`) with a scratch Node preload, not through the local resolver. Public resolvers (Cloudflare and Google DNS-over-HTTPS) already returned Cloudflare's addresses.

| Requirement                                                                         | Evidence                                                                                                                                                                                                                                                                                                                                                                 | Result                                                                                              |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Both Workers deploy to staging and production with placeholder responses            | Bootstrapped with `wrangler deploy`, then redeployed at commit `ba357b1` through `scripts/release.ts`. Full smoke suite passes in both environments: health, error shape, mm-site routing, indexing                                                                                                                                                                      | **pass**                                                                                            |
| `/api/health` reports the right environment in each                                 | production `{"environment":"production","d1":"ok","version_tag":"ba357b1…"}`; staging `{"environment":"staging","d1":"ok",…}`                                                                                                                                                                                                                                            | **pass**                                                                                            |
| Worker refuses to start without a valid `ENVIRONMENT`, or as production with a stub | Tests in `test/worker/guard.test.ts`. `wrangler dev --var ENVIRONMENT:production` fails to start (also asserted in CI). **Remote:** `wrangler versions upload --env staging --var ENVIRONMENT:production --var IMAGE_PROVIDER:stub` rejected by Cloudflare: `Uncaught Error: ConfigError: mm-api refuses to start: IMAGE_PROVIDER is a stub in production [code: 10021]` | **pass**                                                                                            |
| Worker refuses to serve on another environment's database                           | Tests for unmarked, mismatch and unreachable (503). Identity row immutable. `maneman-staging` and `maneman-prod` marked and read back                                                                                                                                                                                                                                    | **pass**                                                                                            |
| Migrations apply in CI                                                              | `migrations apply` job on every PR: all applied to an empty D1, none pending. Remote staging and production: applied with the same command the workflows run                                                                                                                                                                                                             | **pass** locally and remotely. From the deploy workflows: waits on the CI tokens (runbook step 6)   |
| Every PR check runs                                                                 | `ci.yml`: typecheck, lint, format, test, config check, migrations apply, dependency audit, build, smoke (local); all green on PR #1                                                                                                                                                                                                                                      | **pass**                                                                                            |
| Every PR check is required on `main`                                                | Branch protection is refused on this plan                                                                                                                                                                                                                                                                                                                                | **deferred** by the owner to the paid GitHub plan (0008)                                            |
| The binding-redeclaration check fails a deliberately broken config                  | CI requires `test/fixtures/wrangler/broken-staging-inherits-bindings.jsonc` (the real config with staging's queues removed) to fail with `env.staging: queues.producers is not redeclared`. Rule-by-rule tests in `test/node/wrangler-config-check.test.ts`                                                                                                              | **pass**                                                                                            |
| Production workflow demands approval                                                | Runs in the `production` GitHub Environment; required reviewers are refused on this plan                                                                                                                                                                                                                                                                                 | **deferred** (0008). The workflow is manual and accepts only a commit on `main` that passed staging |
| Gradual deployment with automatic rollback on failed smoke                          | Rehearsed against production with the workflow's own commands, listed below                                                                                                                                                                                                                                                                                              | **pass**. The workflow itself runs once the CI tokens exist                                         |
| Structured logs with redaction                                                      | `test/worker/log.test.ts`. Access logs record the route pattern, never the path                                                                                                                                                                                                                                                                                          | **pass**                                                                                            |
| Coverage ≥ 85% lines on `src/`                                                      | `npm run test:coverage`                                                                                                                                                                                                                                                                                                                                                  | **pass**: 99.4%                                                                                     |

### Production rollout rehearsal

1. `release.ts current`: `c319180b…` (bootstrap) serving 100%.
2. `release.ts upload --tag ba357b1…`: new version `0fb896d7…`, no traffic.
3. `release.ts deploy --split 0fb896d7…@10 --split c319180b…@90`.
4. Smoke with `--override mm-api-production=0fb896d7…`: all pass; health reports the new version and tag, so the override pins requests through the zone route.
5. Smoke expecting a wrong tag: **fails** (`version_tag is ba357b1…, expected not-this-release`).
6. The workflow's rollback command, `--split c319180b…@100`: smoke passes on the old version.
7. The success path: 10% canary, smoke, 100%, smoke, mm-site deployed, final smoke. All pass; production now serves `ba357b1`.

### Staging access and R2

- `staging.maneman.in` resolves to Cloudflare. Without an Access session, `/`, `/api/health` and `/robots.txt` all redirect (302) to `summer-math-0275.cloudflareaccess.com`. Production answers 200.
- R2 buckets `mm-{staging,prod}-tryon-{uploads,results}` exist, each with `expire-after-30-days` (expire objects after 30 days; abort incomplete multipart uploads after 1 day), per `wrangler r2 bucket lifecycle list`.

### CI secrets

Checked with `scripts/verify-ci-token.ts` from GitHub Actions (run 35596608538), using the secrets as stored in the GitHub environments. All checks pass in both environments:

- Each Cloudflare token is account-owned and reaches its own two Workers and its own database. It is denied the other environment's Workers, the zone's routes, R2 and Queues. It can read the other environment's database, as accepted in ADR 0008.
- The staging Access service token gets through Access (200). Without it, staging redirects to the Access login. Production is public (200) and holds no Access secrets.
- Getting there took two fixes: turning off Bot Fight Mode, which challenged all traffic from GitHub, and re-copying the Access client ID with its `.access` suffix.

### The pipeline, end to end

M1 merged in PR #1 and PR #2. The merge commit `357c26f` then went out through the workflows alone:

- `deploy-staging`, run 35596946792: every PR check, then migrations (none pending), the database identity check, both Workers at 100%, and the smoke suite through Access against tag `357c26f`. Passed.
- `deploy-production`, run 35597160973. Every step passed and the rollback step was skipped:
  1. Confirmed the commit is on `main` and passed staging.
  2. Uploaded mm-api `67abefa7…` and split traffic 10/90 against the previous version.
  3. Ran the smoke suite pinned to the new version, let it serve 5 minutes, and ran it again.
  4. Promoted to 100% and ran the smoke suite.
  5. Deployed mm-site and ran the final smoke suite.

M1 is done. The exceptions are required checks on `main` and required reviewers on `production`, which the owner deferred to the paid GitHub plan (ADR 0008).

## M2: lead path

Merged in PR #3. Fixes from the staging proof: PR #4 (Zoho call timing, 20-second timeout, a quick retry) and PR #5 (the checker confirms `D1_Person_ID` is unique).

| Requirement                                      | Evidence                                                                                                                                                                                                                                                                                       | Result                                                              |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `GET /api/cities`                                | `test/worker/entrypoints.test.ts`: active cities in display order, `Cache-Control: public, max-age=300`. Local `wrangler dev` answers with the seven seeded cities.                                                                                                                            | **pass**                                                            |
| Booking lead with proposed date and window label | `test/worker/lead.test.ts`: person, `contact` consent (`booking-v1`), pending lead, queued sync; weekday and weekend dates; blackouts; the India date boundary (`test/worker/visit-date.test.ts`). Local `wrangler dev`: Noida, weekend morning → `2026-09-26`, "before noon".                 | **pass**                                                            |
| Waitlist                                         | Mumbai → `served: false`, no date, source `waitlist`; opening a city is an `UPDATE`.                                                                                                                                                                                                           | **pass**                                                            |
| Consents append-only, notices versioned verbatim | Triggers reject `UPDATE` and `DELETE` on `consents`. `test/worker/notices.test.ts` locks the three published texts by hash.                                                                                                                                                                    | **pass**                                                            |
| Idempotency                                      | A replay returns the first response without a second lead; a reused key with a different body gets 422; a key in progress gets 409; a failed request releases its key. Local `wrangler dev` replay confirmed.                                                                                  | **pass**                                                            |
| Rate limits                                      | 5 a day per mobile, 20 a day per IP (configurable). Counter keys are salted hashes.                                                                                                                                                                                                            | **pass**                                                            |
| Validation                                       | Unknown fields, bad names and mobiles, consent not given, unknown or inactive city, malformed JSON: all `400 invalid_request` with field names only.                                                                                                                                           | **pass**                                                            |
| Turnstile                                        | Rejected → 403, unreachable → 503. Locally verified against Cloudflare's siteverify with the test keys. Staging and production widgets created; secrets set on both Workers.                                                                                                                   | **pass**                                                            |
| `crm-sync` against Zoho                          | Adapter tested against the v8 shapes (`test/worker/zoho.test.ts`): insert with `lar_id` and workflows, waitlist unassigned, try-on-only with `trigger: []`, update and note, search before insert, token cache, refresh on 401, errors without record data. Local queue → stub CRM end to end. | **pass**, on staging against the Zoho Developer Edition org (below) |
| A try-on-only lead is never chased               | `test/worker/crm-rules.test.ts`: for every source a non-contactable person gets delivery-only, no assignment and no workflows, and `assertStatusAllowed` throws on any other status.                                                                                                           | **pass**                                                            |
| Sweeper                                          | `test/worker/sweeper.test.ts`: pending leads older than 2 minutes and failed ones under 10 attempts re-enqueued; idempotency and counters purged. On staging the cron runs every five minutes and delivered both drill leads (below).                                                          | **pass**                                                            |
| No personal data in logs                         | Local run: the log contains neither the test name nor the number. Request IDs are carried through the queue into consumer logs.                                                                                                                                                                | **pass**                                                            |
| Free tier                                        | Account confirmed on Workers Free; binding allowlist in the config check (ADR 0009).                                                                                                                                                                                                           | **pass**                                                            |

### Staging proof, 21 September 2026

Leads were booked through the real staging API with the `staging-lead` workflow: Turnstile's dummy token, a random `9xxxxxxxxx` number, and the name "Staging test". Times are Cloudflare's (UTC), from D1, the Worker's logs and Zoho's `Created_Time`.

- [x] **A served-city lead reaches Zoho, assigned, within 60 seconds, with the proposed date on the record.**
  - The first lead (Gurgaon, 13:50:18) missed. Its token refresh passed the old 10-second timeout, and the sweeper delivered it 313 seconds later. That led to PR #4.
  - The later leads took 17.1 s (Gurgaon), 10.3 s (Delhi) and 9.8 s (Noida).
  - Each record has status New, source Booking form, the city, the window, the loss extent, the proposed date and `D1_Lead_ID`.
  - Zoho's timeline for the Delhi record shows the assignment rule "assigns new bookings to technicians" (the `ZOHO_LAR_ID`) and then the "Create" workflow.
- [ ] **Notified:** the org has one user, so the timeline can't show a notification. The owner to confirm the e-mails arrived.
- [x] **A Mumbai lead lands as Waitlist, unassigned.** It took 33.7 s, queued behind the Gurgaon sync. The timeline shows the insert and nothing else: no assignment rule, no workflow.
- [x] **With the Zoho token revoked, the browser still gets 201, and the sweeper delivers within five minutes of restoring it.** The drill: replace `ZOHO_REFRESH_TOKEN` with a dead value, empty `zoho_token`, book a lead, then restore the token.
  - **Drill 1 missed the target.** The browser got 201. Attempts 1 (14:11:26) and 2 (14:12:29, the quick retry) failed with `Zoho 200 invalid_code`. The token was restored at 14:12:46. The 14:15 sweep re-queued the lead, but that consumer run spent 8 min 40 s before its first Zoho call. The 14:20 sweep's run created the record at 14:20:27, 7 min 41 s after the restore. The stalled run then found the record, updated it and added a note, and overwrote `synced_at` with 14:24:17.
  - **Drill 2 passed.** The browser got 201. Attempts at 14:27:04 and 14:27:37 failed. The token was restored at 14:27:47, and the 14:30 sweep delivered the lead at 14:30:31, 2 min 44 s later.

**What the proof found**, recorded in ADR 0012:

- **Overlapping runs.** Queues ran two consumer invocations at once, despite `max_concurrency: 1`. Zoho refuses a second record with the same `D1_Person_ID`, so this cannot duplicate a record. It can add an extra update and note. `scripts/check-zoho-setup.ts` now fails if the field allows duplicates.
- **Search lag.** Zoho's search didn't find a new record 25 seconds after it was created, but did by two minutes.
- **An unexplained stall.** One consumer run waited 8 min 40 s with no Zoho call, so the time went to its first D1 queries or to the platform; from inside the Worker the two look the same. It delayed one lead and lost nothing. If it recurs, it goes to Cloudflare support.
- **No duplicates.** Seven test people, seven Zoho records.

## M3: try-on and messaging

Merged in PR #6. Fixes from the staging proof: PR #7 (a WhatsApp send that timed out is not retried), PR #8 (slow renders are followed for 15 minutes) and PR #9 (timing for stalled consumer runs). The code is also checked locally against the stub AILabTools, which the real adapter talks to over a fake HTTP API with the documented response shapes.

| Requirement                                                        | Evidence                                                                                                                                                                                                                                                                                                                 | Result                       |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| Reference material copied and read, with an ADR of every departure | `docs/reference/ailabtools-api-notes.md` and `data/ailabtools-catalog.json`, verbatim; `docs/reference/README.md`; `docs/decisions/0013-departures-from-the-ailabtools-harness.md` (14 departures)                                                                                                                       | **pass**                     |
| Upload with photo consent                                          | `test/worker/tryon-api.test.ts`: consent must be literally `true` with the photo notice's version; Turnstile; 5 an hour per address; the daily upload ceiling. Through the API, not a presigned link (`docs/decisions/0014-try-on-api.md`): one R2 write per job, JPEG or PNG by its bytes, at most 5 MB, 200 to 4090 px | **pass**                     |
| Generate with colour routing and deduplication                     | Detected colours sent as they are; `unknown` goes to Premium with `original`, and the route is recorded; an identical request returns the existing job; a different look needs the session                                                                                                                               | **pass**                     |
| Render consumer: delayed-retry polling, download-only retry        | `test/worker/render.test.ts`: polls every 5 s, then 10 s; fails at 180 s; submits once however often the message is delivered; a stalled download recovers from the stored URL with one submit; a URL that expires fails the job with an alert                                                                           | **pass**                     |
| Premium's wrong-extension 502 is `photo_invalid_file`              | `test/worker/ailabtools.test.ts` and `render.test.ts`, through the stub's replay of the 502                                                                                                                                                                                                                              | code **pass**; staging below |
| Status                                                             | `GET /api/tryon/status/:job_id`: state, and the failure code once failed                                                                                                                                                                                                                                                 | **pass**                     |
| Claim before `ready`                                               | A gate while rendering saves the person (not contactable), both consents, a `tryon` lead with the stage as its loss extent, a session cookie and a waiting message, and queues the CRM sync; idempotent, 3 a day per number                                                                                              | **pass**                     |
| Session-scoped results and more looks                              | Results only for the owning session; a second look is a new job on the same photo, with no second gate or lead, and logs `try_on_additional_look`                                                                                                                                                                        | **pass**                     |
| Spend ceiling                                                      | Global daily ceilings on uploads, renders and result reads; the render ceiling trips at 3 in `tryon-api.test.ts`; alerts once a day                                                                                                                                                                                      | **pass**                     |
| Free tier                                                          | `test/node/free-tier-budget.test.ts`: the committed ceilings of both environments stay under 80% of every Queues and R2 allowance (`docs/decisions/0015-render-pipeline.md`)                                                                                                                                             | **pass**                     |
| Credit monitor                                                     | `test/worker/sweeper.test.ts`: the hourly run sums the pools and alerts below the floor                                                                                                                                                                                                                                  | **pass**                     |
| Messaging queue                                                    | `test/worker/messaging.test.ts`: sends a one-hour signed link; skipped when messaging is off, the person is erased, the number is not on the allowlist, or three have gone today; retried three times, then failed with an alert. Through Evolution for now (`docs/decisions/0016-whatsapp-through-evolution.md`)        | code **pass**; staging below |
| Try-on-only lead in Zoho as `Try-on — delivery only`, unassigned   | M2's rules (`test/worker/crm-rules.test.ts`); the claim writes the lead the sync reads                                                                                                                                                                                                                                   | code **pass**; staging below |

### Staging proof, 21 September 2026

Run with `scripts/staging-tryon.ts` through Cloudflare Access, and with `scripts/ailabtools-probe.ts` directly against AILabTools with the staging key. Times are Cloudflare's (UTC).

The photos were supplied by the owner and kept outside the repository:

- three front-on men with hair loss, each cropped at the eyes or nose;
- a side profile;
- a two-face image composed from two of them.

Their licences are unknown; the owner chose to use them for this internal test.

- [x] **A Pro render and a Premium render both complete, with measured latency recorded.** From submit to stored result: Pro 27.1 s and 58.9 s, Premium 99.8 s. Results were 1288 × 808 PNGs of 0.95 to 1.9 MB from an 800 × 500 photo, well under the 6 MB cap.
  - An earlier Premium render was still running at 189 s. The prompt's 180-second deadline failed it, though it had been billed. AILabTools finished it about 6½ minutes after submitting. Renders are now followed for 15 minutes (PR #8, docs/decisions/0015).
- [x] **A deliberately wrong filename extension to Premium is classified `photo_invalid_file`.** A JPEG sent to Premium named `portrait.avif` got 502, "AI service internal error … File type not supported". The adapter classified it `photo_invalid_file`, and it billed 0 credits.
- [x] **The credits check proves a rejected face bills nothing.** The side profile ("No face detected") and the two-face image ("Multiple faces detected") were each accepted, then refused at the first poll, and billed 0 credits. No pre-check is needed (docs/decisions/0017).
- [x] **A forced download failure recovers from the stored URL without a second billed render.**
  - The failure was simulated on a finished Premium job: its stored result was deleted from R2, and the job was set back to `downloading` with no attempts.
  - The 16:25 sweep re-enqueued it, and the render consumer downloaded the result again from the stored AILabTools URL on its first attempt.
  - The balance was 1,680 credits before and after. The real download-failure path (three quick tries, then the sweeper) is covered by `test/worker/render.test.ts`.
- [x] **A gate submitted while the render is still running creates the lead at once, and the result appears when ready.**
  - The gate was submitted 5 s in, with the job still `queued`. It returned 201 with the lead, `whatsapp_copy: true` and the session cookie. D1 held both consents (`gate-v1`, `photo-v1`) and a `tryon` lead with the stage as its loss extent.
  - The result was ready at 59 s, and the session fetched it.
- [x] **A second look releases without a second gate or a second lead.** Proven on staging as written. Then superseded by the owner's decision of one look per visitor (docs/decisions/0018): a second look is now refused.
- [x] **The WhatsApp copy arrives on a test handset**: confirmed by the owner, who received it three times.
  - The first result's message was `sent` on its third attempt. The first two timed out after the bridge had already fetched the image, and all three reached the handset. A timeout is no longer retried (PR #7, docs/decisions/0016).
  - The bridge is the Evolution API on port 8443 of the owner's Tailscale Funnel host; port 443 there serves another app.
- [x] **With `MESSAGING_ENABLED=false`, the claim returns `whatsapp_copy: false` and nothing is sent.** A staging version with messaging off was deployed for the test. The claim returned `whatsapp_copy: false`. When the render was ready, its message went from `queued` to `skipped` ("messaging is off") with no attempt.
- [ ] **A try-on-only lead is in Zoho as `Try-on — delivery only`, and is not assigned**: the owner to confirm in Zoho, record `32619000000175412`. In D1 the person is not contactable, and the sync inserted a new record, which the rules make `Try-on — delivery only` with no assignment rule.
- [x] **The ceiling trips at 3 and returns `503`.** The same version set `RENDER_DAILY_CEILING` to 3, and today's counter was reset. Three generates got 202, and the fourth got 503 `busy`, with its job `failed` / `busy`. The counter stopped at 3, and the ceiling alert fired once. Staging then went back to the pipeline's version, `b434a6c1`.

**Also seen:**

- **The stall recurred.** A CRM sync spent 2 min 10 s before its first Zoho call, as in M2. The steps before the first outside call are now timed (PR #9, docs/decisions/0012).
- **Queue delivery adds seconds.** A new job waited 10 to 25 s for its first delivery, and a 5-second poll delay was 10 to 15 s in practice.

## M4: hardening and handover

| Requirement                         | Evidence                                                                                                                                                                                                                                                                                                                                                                          | Result                       |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Erasure                             | `test/worker/erasure.test.ts`: photos and results deleted from R2; the person blanked, their number replaced; sessions ended; jobs expired; one withdrawal consent per purpose; a `person_erased` event; the CRM update queued. A wrong or missing secret gets 401, an unknown or erased number 404. The number can book again as a new person (`docs/decisions/0019-erasure.md`) | code **pass**; staging below |
| Unsent messages cancelled           | The same test: `waiting` and `queued` messages become `skipped`, and a `sent` one is left alone. The messaging consumer also skips anyone erased (`test/worker/messaging.test.ts`)                                                                                                                                                                                                | **pass**                     |
| The CRM record blanked              | `test/worker/zoho.test.ts`: the record found by its stored ID or by `D1_Person_ID`, updated with workflows off, and noted. `test/worker/crm-sync.test.ts`: once however often the message comes; a scrubbed error; a quick retry, then the sweeper, then an alert; an erased person's lead is never sent                                                                          | code **pass**; staging below |
| A render finishing after an erasure | `test/worker/render.test.ts`: the result is deleted when the job was erased during its download, and kept when a parallel run stored it. `erasure.test.ts`: a result stored between erasure's read and its batch is deleted                                                                                                                                                       | **pass**                     |
| Redaction test                      | `test/worker/log.test.ts`: names, numbers, e-mails, images and credentials redacted by field name at any depth, and numbers scrubbed from free text. Route and consumer tests check their log lines hold no name or number, erasure included                                                                                                                                      | **pass**                     |
| Coverage gate                       | `vitest.config.ts` fails the run below 85% of lines in `src/`; CI runs it on every pull request. After the erasure proof: 383 tests, 97.4% of lines                                                                                                                                                                                                                               | **pass**                     |
| 50 concurrent lead submissions      | `scripts/load-test-leads.ts` on staging (below)                                                                                                                                                                                                                                                                                                                                   | **pass**                     |
| `docs/api.md` generated             | `npm run openapi` writes `docs/openapi.json` and `docs/api.md` from the zod schemas; `test/worker/contract.test.ts` fails if either is out of date                                                                                                                                                                                                                                | **pass**                     |
| Runbook                             | `docs/runbook.md`: provisioning, secrets, free tier, replaying leads and messages, D1 point-in-time restore, erasure within the day, cities and blackout dates, rolling back a Worker version                                                                                                                                                                                     | **pass**                     |
| One production release              | To come, once the owner has supplied production's secrets                                                                                                                                                                                                                                                                                                                         | pending                      |

### Load test, 21 September 2026

`scripts/load-test-leads.ts` sent 50 requests at once to staging at 16:43:53 UTC: 25 test people, each booked twice with the same `Idempotency-Key`, as a double-tapped submit would be. Staging's limit of 20 leads a day per address is below 50, so the test ran on a staging version with that limit raised to 200. Staging then went back to the pipeline's version.

- All 50 answered within 2.1 s (median 1.6 s). 25 got 201, and their 25 twins got 409 `idempotency_in_progress`.
- One lead ID per person: no duplicates in D1.
- 25 records in Zoho, one per person, all synced about 70 s after the burst. None failed.

### Erasure on staging, 21 September 2026

Run through Cloudflare Access with `scripts/staging-tryon.ts` and `scripts/erase-person.ts`, against a fresh random test number that isn't on the messaging allowlist. Times are the Worker's (UTC).

1. **Setup.**
   - Try-on A rendered on Pro in 25 s. It was gated once ready, giving a try-on lead and a Zoho record. Its message was skipped: the number isn't on the allowlist.
   - Try-on B was gated at once, leaving a `waiting` message. It was erased 3 s into its render.
2. **`POST /api/erasure` at 17:17:05** answered 200: 2 photos deleted, 1 result deleted, 1 message cancelled.

- [x] **Photos and results deleted.** Both uploads and A's result are gone from R2. B's result was never stored. The check was proven against a result known to exist.
- [x] **The person blanked in D1.** Name "Erased", no e-mail, the number replaced, not contactable. Both jobs are `expired` with `upload_deleted_at` set. The try-on session is gone, and the running script's next result request got 403 `session_required`.
- [x] **Unsent messages cancelled.** B's `waiting` message became `skipped`, "person erased". A's had already been skipped.
- [x] **Withdrawal recorded.** A withdrawal row for `tryon_photo` and for `result_delivery`, after the four consents given. A `person_erased` event carries the counts only.
- [x] **The CRM blanked**, 9.7 s after the erasure, on the first attempt: `crm_erased` with `found: true`, Zoho `update` 200 and `note` 201.
- [ ] **In Zoho**, the record shows "Erased" with no mobile, e-mail or contact consent, and the note "Personal data erased": the owner to confirm. Also whether the record's timeline still shows the old name or number (docs/decisions/0019-erasure.md, open for legal).
- [x] **No personal data in the logs.** The Worker's logs from 17:16 on contain neither the number, in either form, nor the name.
- [x] **The render in flight stopped.** B was submitted at 17:17:02 and billed. The render consumer found it expired, and its result was never fetched.

**What the proof found:** B's lead sync wrote the person's details to Zoho at 17:17:05.36, 0.2 s before the erasure; the erasure's blanking landed 9 s later. Had the two run the other way round, the details would have been back in Zoho with D1 saying they were erased. A sync now blanks the record again if the person was erased while it ran (docs/decisions/0019-erasure.md).

**The staging deploy of the erasure code** failed its first smoke check: for 12 s after the deploy, the edge still served the previous version. The job was re-run and passed, and the smoke check now allows a minute.
