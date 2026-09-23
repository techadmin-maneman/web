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
| One production release              | `deploy-production` released `268eaa4` on 21 September 2026 (below)                                                                                                                                                                                                                                                                                                               | **pass**                     |

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

### Production release, 21 September 2026

Production had run the M1 skeleton until now. Its secrets were set first. Zoho is staging's test org for now, at the owner's request (docs/decisions/0020-production-on-the-zoho-test-org.md). `scripts/check-zoho-setup.ts` passed with production's values.

`deploy-production` released `268eaa4` (PR #13's merge), which had passed staging:

1. Migrations 0002 to 0004 were applied to `maneman-prod`, and its identity mark checked.
2. The new `mm-api` version (`b12f0181`) served 10% of traffic for 300 s. It was smoke-tested before and after, pinned to the new version.
3. It took all traffic and passed the smoke again. Then `mm-site` was deployed, and the final smoke passed. No rollback.
4. `npm run apply-triggers -- --env production` attached the 5-minute cron and the three queue consumers.

`GET https://maneman.in/api/health` reports production, version `b12f0181`, tag `268eaa4`, D1 ok. The first cron sweep ran at 17:45:57 and found nothing to do.

Messaging is off in production (`MESSAGING_ENABLED=false`), and the site is still the placeholder.

## The public site: F1 to F3, on staging

The site is built from the front-end prompt in four milestones, on staging only. Production keeps its placeholder until the owner releases the site and the backend together.

### F1: the static port, 21 September 2026

PR #15 put the static port of Mane Man Site v2 on `https://staging.maneman.in`. Each section and state was checked against the design at 390 and 1440 px, pair by pair (`docs/fidelity/`), and each item in `docs/feature-inventory.md` names its evidence.

### F2: booking, 22 September 2026

PR #16 wired the booking form to the API. On staging, a booking made through the page at 390 px, after a landing with `?utm_source=f2-proof&utm_campaign=staging`:

- [x] `POST /api/lead` answered 201 and the page showed the proposed day and window.
- [x] Lead `6bca5f49-ac8c-48b7-9797-90c9c24d9ff5` reached the Zoho Developer Edition org as record `32619000000175601` on the first sync attempt: `Proposed_Visit_Date` 2026-09-24, status New, assigned, UTM source `f2-proof` and campaign `staging`.

### F3: the try-on, 22 September 2026

PR #17 wired the try-on to the API; staging runs `4f37d5f`. The proof used a Pixel 7 profile, with Chrome's Slow 4G (150 ms, 1.6 Mbps down, 750 kbps up) and a CPU slowed four times. It used an internal test photograph and a random number, not an allowlisted one, so no WhatsApp message was sent. Turnstile was the stand-in widget giving Cloudflare's dummy token, which staging accepts.

| Time       | Step                                                                      |
| ---------- | ------------------------------------------------------------------------- |
| 3.8 s      | `/try` loaded and hydrated                                                |
| 4.6 s      | Continue on the consent screen: upload link 201                           |
| 5.3 s      | Generate pressed                                                          |
| 5.7 s      | Photograph uploaded: 204, 40,537 bytes                                    |
| 6.9 s      | Render queued: 202, `crown`, `full-natural-short`, `hair_color` `unknown` |
| 8.9–23.7 s | Status polled every 3 s                                                   |
| 25.6 s     | The gate opened                                                           |
| 26.9 s     | Claimed: 201, with the job still `rendering`                              |
| 37.9 s     | Result ready                                                              |
| 44.3 s     | Result shown                                                              |

- [x] **A real render on a phone profile over 4G.** AILabTools Pro rendered it in 23.8 s.
- [x] **The gate submitted before the render finished.** The job was `rendering` when the claim returned.
- [x] **The upload ran during the choices.** It finished before Generate's request went out.
- [x] **The render keeps the person's face, for a photograph taken as v2 asks.** The first photograph did not keep it. The photograph is cropped above the mouth, with the eyes turned up, against v2's guidelines, and Pro returned a different person's face. It stored and served the result under the proof job's own ID, and the upload in R2 was the page's photograph. The same generated face came back for this photograph's backend renders earlier in the day. So the provider, not the site, replaces a face it cannot read. None of the owner's five test photographs is taken straight on. The owner then supplied a straight-on portrait (below), and that render kept the face. Whether the page should refuse photographs whose face runs off the frame is open for the owner.

The site's hair-colour detector agreed with the harness's own detector on all five test photographs. Two read brown, one white; two could not be read, which the harness defaults to black and the site sends as `unknown`.

### F3 again, with a straight-on photograph, 22 September 2026

The owner supplied a straight-on portrait for this run. It is not kept in the repository. The run used the same phone profile, Slow 4G and a random number as before, and staging ran `493c978`.

- [x] **The render kept the face.** It is the same person, with the same glasses, suit and tie, and a fuller hairline. So the stranger's face earlier came from a photograph that breaks v2's guidelines, not from the pipeline.
- [x] **The gate was submitted before the render finished.** The claim returned at 26.6 s with the job `rendering`.
- [ ] **The result was shown as soon as it was ready.** Not in the first run. The render was ready about 31 s in, but the page showed it only at 92.8 s. A second run showed it at 44.5 s, with a poll every 3.6 s, each answered in about 0.2 s. In the first run, the result requests between 27 s and 86 s got no answer at all. The backend recorded nothing unusual, so a request was most likely stuck in transit, and it held up every poll after it. **Fixed:** each poll now gives up after 10 s and the next one goes out. `e2e/try-flow.e2e.ts` › "a result request stuck on the way" fails without the fix.
- **The hair colour read as `unknown`,** and the backend rendered it black, which suits the photograph. The detector is the harness's, and the reason is recorded in ADR 0022, 31.

### The owner's review, on staging, 22 September 2026

Staging ran `5e82022` (PR #20). This used one real render of the owner's portrait, on the same phone profile and Slow 4G.

- [x] **The number is optional.** At the gate the number was left out. The result showed at 49.4 s, and the page made no claim, so there was no lead and no message.
- [x] **The look is shown again.** Back on `/try` in the same browser, a second photograph was refused (`403 look_limit_reached`). The page asked `GET /api/tryon/look` (200) and showed the first look within 7 s, under "The look you had.", with its label "Full density · Natural hairline · short". There was no second render.
- [x] **Layouts.** The Norwood scale and How it works render as ADR 0022, 34 and 35 describe (`docs/fidelity/`).
- [x] **Leads reach the CRM.** Every staging lead, from bookings and try-on claims alike, synced to the Zoho test org on its first attempt, about 10 s after it was made. Each created a new record (`lead_synced`, `created: true`).

## Phase 2: the proofs still to run, 23 September 2026

Everything above was written after the event, from logs, databases and the Zoho org. This section is written before it. It records, for P2-M2, P2-M3, P2-M5 and P2-M6, the checks each milestone's prompt asks for, how each one is proven on staging, and what staging cannot prove yet.

**Nothing below has been observed** when this section was written. Every check was left unticked and marked **not yet run**. Where a check names a figure, a screen or a log line, that is what a correct result looks like, not what was seen.

P2-M2 and P2-M5 have since been run, on 23 September 2026, and their two sections are now a record of what happened. P2-M3 and P2-M6 are still written before the event, and are still marked **not yet run**.

| Milestone | What it covers                                                                                                                                                  | Merged in                                                   |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| P2-M2     | The FSM and Books connection, the mirror, the reconciliation, visit photographs, the payments mirror, Books receipts, and booked leads into FSM                 | PRs #41 to #46, #49 and #54; the app's read surfaces in #48 |
| P2-M3     | Pincodes, referral codes, the landing's APIs, the waitlist, the credit ledger, the grant, fraud holds, ops' review, the cards, the preview image and the import | PR #62                                                      |
| P2-M5     | The price book, availability, holds, Razorpay Checkout, credit redemption, moving and cancelling under the 24-hour rule, refunds and late fees                  | PRs #50, #51 and #55, with #63; the app's booking in #52    |
| P2-M6     | Erasure reaching Phase 2's data and FSM, the client's own export, grievances, the retention jobs and the breach runbook                                         | PR #62                                                      |

### How every proof below is run

- **Access.** Every staging host is behind Cloudflare Access (runbook, step 11). A script gets through with the `mm-ci-staging` service token in `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`; a person gets through with the founders' login. Only `/api/hooks/` and `/api/result/` bypass it, and each checks its own secret (runbook, steps 10 and 12).
- **The hosts** are `https://staging.maneman.in` (public), `https://app-staging.maneman.in` (client), `https://ops-staging.maneman.in` (ops) and `https://tech-staging.maneman.in` (technician), all four surfaces switched on since 22 September 2026 (`src/config/environments.ts`). `npm run smoke -- --environment staging --surfaces` says whether each host answers before anything else is tried; on 23 September 2026 all three checked hosts passed on version `f6d314a9`.
- **A handset on the allowlist.** A client signs in with a six-digit code on WhatsApp; SMS is off (`SMS_PROVIDER` is `none`, open point 17) and staging sends only to its allowlist. So every proof that needs a login, or a message, needs a test handset whose number is on that allowlist.
- **The ops console exists.** It is deployed on `ops-staging.maneman.in` (the `mm-ops` Worker; the page says so in its `mm-worker` meta tag) with six sections: Dispatch, Clients, No-shows, Referrals, Waitlist and Technicians. There is no Tasks section and no Payments section: no route answers either, and both are open points (57 and 58). An ops check is a screen where one of those six covers it, and an HTTP request to `ops-staging.maneman.in` through Access where none does. Scheduling and assigning still happen in FSM or on the Dispatch board; no ops route creates a visit.
- **SQL** is `W d1 execute maneman-staging --env staging --remote --command "<sql>"`, as the runbook's preamble sets out. **The logs** are Workers Logs on the `mm-api` Worker.
- **No personal data.** As in Phase 1, each test person is "Staging test" with a random `9xxxxxxxxx` number, except the one allowlisted handset a message must reach. No real person's name, number or photograph goes into this record or into a test.
- **Staging's placeholders** (`docs/open-points.md`) are the ground every proof stands on: the price book holds the design's figures (item 1) at 0% GST (items 2 and 3), every NCR pincode is served from 22 September 2026 (item 21), message texts are placeholder (items 19 and 40), the house referral card is a placeholder (item 43), and the CRM, FSM and Books are all in the owner's real org with staging's records labelled "Staging test" (items 10 and 11).

## P2-M2: the mirror and the read surfaces

The FSM and Books providers, the mirror kept by webhook hints and a queue, the reconciliation, a visit's photographs into `mm-staging-client-photos`, the payments mirror from Razorpay's signed webhook, Books' receipts, and a booked lead reaching FSM as a Request (ADRs 0032 and 0044). The code is checked in `test/worker/fsm-mirror.test.ts`, `reconcile-fsm.test.ts`, `visit-photos.test.ts`, `client-visits.test.ts`, `razorpay-hook.test.ts`, `client-payments.test.ts`, `books-sync.test.ts` and `fsm-leads.test.ts`, against the stub FSM and the recorded Zoho shapes.

### The checks the prompt asks for

From `docs/prompts/phase2-backend.md`, P2-M2:

> - a staff-run job in the FSM trial org appears in `/visits` with its five-angle before-and-after set
> - the invoice PDF opens
> - a deliberately broken webhook is repaired by the nightly reconciliation

The prompt says "the FSM trial org". Staging's org is the owner's real one, with its records marked as tests (ADR 0025, item 26; open point 10).

### The staging proof, 23 September 2026

Run against `https://staging.maneman.in`, `https://app-staging.maneman.in` and `https://ops-staging.maneman.in` through Access, with the FSM and Books credentials the Worker itself uses, and Razorpay in test mode. Times are the Worker's and FSM's, in UTC. Every test person is "Staging test" with a random `9xxxxxxxxx` number; every FSM record made for the proof begins "Staging test:".

Three arrangements were made by hand, and each is named where it bears on a result:

- **No one signed in.** Staging sends WhatsApp only to its allowlist, and a test number is not on it, so the login code was never delivered and could not be read (it is kept peppered). The client sessions were written straight into `sessions`, which is the SHA-256 of the cookie's token (`src/domain/sessions.ts`). **The login itself is not proven here**; it needs the owner's handset.
- **A completed consultation** was written into `appointments` for the first-fit client, so that `bookableTypes` would offer a first fit, rather than running a second job in FSM for it.
- **Three credits** were granted with a `credit_ledger` row of kind `grant`, source `ops`, as ops would.

Two other proof runs were working against the same staging database and the same Zoho org that morning, so rows and records other than the ones named below are theirs, not this proof's.

### How each was proven

- [x] **A staff-run job appears in `/visits` with its five-angle before-and-after set.**
  1. **The lead.** `scripts/staging-lead.ts` booked Gurgaon, weekday morning, at **07:47:10.409**. Lead `0a5ef320-0413-4525-9fad-7de71a9c31f0`, proposed date 2026-09-25, window "before noon". `leads.fsm_request_id` held `8229000000304279` by **07:47:19.687** — 9.3 s. FSM's Request REQ4 has the summary "Staging test: Consultation for Staging test", `Preference_Note` "Morning, 9 am to 12 pm", `Preferred_Date_1` and `Due_Date` 2026-09-25, and the contact `8229000000305231` the sync created.
  2. **Scheduling it in FSM did not go the way the prompt describes.** The Request's blueprint transition **"Convert to Work Order" answered SUCCESS and created no work order**: the Request moved to "Work In Progress", its `Work_Orders` stayed empty, and the org held the same single work order before and after. FSM's own screen opens a form there, which the API does not. So the job was made the way our own booking makes one: work order `8229000000305234` (WO13) of type Service on the Service visit item with the contact's addresses, and appointment `8229000000304285` (AP-14) on its service line, assigned to the one technician, 14:00 to 15:30 India time.
  3. **The hint arrived and the mirror wrote the copy.** `webhook_inbox` row `fcb09d2c-65e3-4ffd-ae0b-63c6f0d09852` at **07:52:31.574**, 0.6 s after the appointment was created; the copy `ab7b388c-c8d1-4525-af6a-010c30e3f944` was written at **07:52:45.144**, matched to the person by mobile number, type `service`, status `scheduled`, technician and city as FSM has them. Four hints were taken for this appointment over the run — one for the create, three for Dispatch, Start Work and Complete Work — each once, none with an error. The first was processed in 15.8 s and the second in 7.1 s; the last two took 46.2 s and 40.5 s, because the photographs were copied in them.
  4. **The job was run in FSM**: ten photographs attached, then Dispatch, Start Work and Complete Work, and the work order Completed and Closed. The photographs are 240 × 160 PNGs made for the test — flat colour, no person in them — named `before-front.png` through `after-hair.png`.
     - **The first ten attempts failed.** FSM answered `400 INVALID_DATA`, `"required field not found"` for `File_Id`. The upload to `/fsm/v1/files` answers `{ data: { file_id } }`, but the Attachments module takes **`File_Id`**, and `src/providers/fsm-zoho.ts` sent `file_id`. Sent as `File_Id`, all ten attached. **Fixed**, with `test/worker/fsm.test.ts` › "attaches an uploaded file by File_Id" to hold it. Nothing else uses that call yet: the mirror only reads attachments, and the technician app's own upload (P2-M4) is what would have hit it.
  5. **The mirror copied them.** The appointment became `completed` at **08:01:53.127**, with a `visits` row of outcome `done`; the export finished by **08:02:29.571**. `SELECT ps.phase, COUNT(*) …` gives `before 5` and `after 5`, stored under `visits/ab7b388c-…/` in `mm-staging-client-photos`.
  6. **Read as the client.** `GET /api/visits/{id}` returns both sets with the angles in the order front, top, left, right, hair. A photograph's link `/api/photos/file/<token>` answers **200 `image/png`** to the owning session, **401 `session_required`** without one, and **404 `not_found`** to the other test client's session, which also gets 404 on the visit itself. The token issued at 08:02:54 expired at 08:17:54: fifteen minutes.
  - Two fields are empty, and neither is a fault: `duration_minutes` is 0 because the job was started and closed seven seconds apart, and `what_was_done` is null because the job-sheet template is a placeholder (open point 13).
- [ ] **The invoice PDF opens.** **Not proven: the invoice could not be raised.**
  - The closed work order carries `Grand_Total` and `Sub_Total` of 2000 rupees and `Billing_Status` "Not yet Invoiced" — the price book's service-visit figure, with no tax, as open points 1 to 3 say it will be.
  - FSM's API would not raise the invoice. `POST /fsm/v1/Invoices` answers **`500 INTERNAL_ERROR`** with no detail, both for a body naming the work order alone and for one naming the contact, both addresses, the date and the service line. `/fsm/v1/Work_Orders/{id}/actions/create_invoice` is `404 INVALID_URL_PATTERN`. The work order's blueprint offers Complete, Cancel and Terminate, then Close, and no invoice step. `GET /fsm/v1/Invoices` answers 204: the module is there and empty.
  - **What would prove it:** the owner presses Create Invoice on work order **WO13** (`8229000000305234`) in FSM's own screen. FSM and Books then sync on their own (open point 38), the mirror reads `Invoice_Id` on to `appointments.fsm_invoice_id`, and `GET /api/documents/{visit_id}` streams the PDF.
  - What was proven is the state before that: with `fsm_invoice_id` null, `GET /api/documents/ab7b388c-…` answers **`409 not_ready`**, which is what the app shows as E3's "The invoice is still generating".
- [x] **A deliberately broken webhook is repaired by the reconciliation.**
  - The reconciliation is not only nightly: it runs with the sweeper every five minutes over the 50 appointments FSM changed most recently, and walks the whole list overnight between 1 and 5 am India time (ADR 0032). The five-minute part is what was proven; the overnight pass was not, and the departure from the prompt's word stands.
  - **The rule was not switched off.** Deactivating the workflow rule needs FSM's Setup screens, which the API does not reach. The same condition — FSM changed, no hint came — was arranged instead by rolling the copy back by hand: the first-fit appointment `ffd24370-33ec-4aa2-81ed-81fd85000214` (FSM `8229000000306278`) was set to its old window, 2026-09-24T03:30Z, and its `fsm_modified_at` back to 08:00:00, while FSM held 2026-09-30T03:30Z and 08:39:15. Nothing changed in FSM, so no hint could come.
  - **The mirror was stale**, and `SELECT COUNT(*) FROM webhook_inbox WHERE record_id = '8229000000306278';` stayed at 3 throughout.
  - **The five-minute run repaired it**, twice. The second time, with the log being followed: the copy was rolled back at **08:48:05**, and at **08:50:50.757** `fsm_reconciled` logged `queued: 1`, then at **08:50:58.855** `fsm_synced` logged `request_id: "reconcile"`, `fsm_id: 8229000000306278`, `outcome: "written"`. The copy's `window_start` was 2026-09-30T03:30Z again and its `fsm_modified_at` 08:39:15, matching FSM, with `synced_at` 08:50:56.716. The first run of the drill, at 08:41:37, was repaired the same way at 08:45:55.907; only its log lines were missed, because the tail had dropped.
  - No hint arrived either time: `webhook_inbox` for that record stayed at three rows, the latest received at 08:39:16.
  - **The hint path still works**, as the four taken hints on the other appointment show, each with `processed_at` set and `last_error` null.
- [ ] **The overnight pass and its one alert.** **Not run.** It needs a run between 1 and 5 am India time, which is 19:30 to 23:30 UTC. It is `fsm_drift_repaired`, once at the end of a pass, with what it repaired.

### Also proven with this milestone

- [x] **A test payment reaches the mirror from Razorpay's webhook.** Netbanking in test mode, through Checkout on the real order. Razorpay sent `payment.authorized` at **08:23:59.226**, `payment.captured` at **08:23:59.998** and `order.paid` at **08:24:00.246**; `razorpay_events` holds each once.
  - The `payments` row: reference **`MM-2026-0001`**, status `captured`, method `netbanking`, amount 200000 paise. The reference is the first of the year, not the `MM-2026-0841` this section guessed at, and the columns are `status` and `amount`, not `state` and `amount_paise`.
  - **A repeat changed nothing:** `order.paid` queued the same hold a second time, and the consumer answered `booking` with `outcome: "already_booked"` at 08:24:14.338, 0.2 s after the first booked it.
- [x] **The payment is recorded in Books, and its receipt opens.** `books_synced` with `recorded: 1` at **08:25:53.384**, 1 min 53 s after the capture — not the three hours ADR 0044 allows for, because the lead sync had already given the contact a Books customer. `payments.books_payment_id` is `4242595000000067002`; in Books it is payment 3 against customer `4242595000000063010` "Staging test", mode Razorpay, dated 2026-09-23. `GET /api/payments/{id}` carries `documents.receipt`, and `GET /api/payments/{id}/receipt` answers **200 `application/pdf`**.
  - All three of the run's captures reached Books the same way — ₹2,000, ₹30,000 and ₹4,000 — each within a five-minute pass. `books_applied_at` stays null on all three, correctly: there is no invoice to apply a payment to.
- [x] **A booked lead reaches FSM as a Request.** Twice: lead `0a5ef320-…` in 9.3 s (above), and lead `4ec71640-08a9-4849-860a-2b6e6f032b74` at 08:27:52.657 as Request `8229000000306245` by 08:28:02.015, 9.4 s. The Request's note carries the window in words.
- [x] **The ops console shows the work.** `GET /api/dispatch` on `ops-staging.maneman.in`, which is what the Dispatch board draws, returned the week from 2026-09-23 with the technician's row, the day's blocks and the client as "Staging t.", the sector, and the visit type — including this proof's service visit on 23 September.

### What the proof found

- **`attachToAppointment` sent the wrong field name.** FSM's Attachments module takes `File_Id`; we sent `file_id`, and every attachment was refused with `400 INVALID_DATA`. Fixed, with a test. The mirror only reads attachments, so nothing in P2-M2 depended on it; the technician app's own upload (P2-M4) does.
- **An invoice cannot be raised over FSM's API** (open point 60), so the second of the prompt's three checks cannot be run without the owner.
- **"Convert to Work Order" over the API creates no work order** (open point 61). A Request converted that way is left at "Work In Progress" with nothing behind it.
- **A Zoho auth outage refunds paid bookings.** Minting access tokens by hand alongside the Worker exhausted Zoho's refresh quota for about ten minutes; every FSM call on staging failed with `Access Denied`, and three bookings in flight were given up on after five attempts and refunded, with an alert each (open point 62). The outage was this proof's doing, and it recovered on its own, but the behaviour it exposed is the owner's to rule on.

### What staging cannot prove yet

- **Nobody signed in.** Staging messages only its allowlist, so the login code never leaves the Worker for a test number, and the sessions here were written by hand. The code path itself — `POST /api/auth/otp`, then `POST /api/auth/verify` — needs the owner's handset.
- **The prices and the tax.** FSM's service items were created at the design's placeholder prices (ADR 0032), and GST is 0% in the price book and off in Books (open points 1, 2 and 3). A receipt proves the path, not the figure. The invoicing route itself waits on the CA's answers.
- **The photographs are FSM's.** Until our technician app (P2-M4), a set depends on the technician naming files by phase and angle, and FSM's app uploads them at full size, several megabytes each (open point 34). This proof's ten were made for it, 80 KB each, so nothing here says what R2 will hold in practice. The job-sheet template is a placeholder (open point 13), so `visits.partial_reason` stays empty, `what_was_done` is null in `/visits`, and a partial outcome cannot be proven with its reason.
- **One technician.** The owner is the only FSM user and technician (open point 12), so nothing about work between technicians is proven here.
- **The trial's clock.** FSM and Books are on trials that end around 6 October 2026 (open point 9). After that FSM drops to Free, which has no assets or job sheets, so this proof must be run before then, or after a subscription.
- **Production's side is absent.** Production holds `FSM_PROVIDER`, `BOOKS_PROVIDER` and `PAYMENTS_PROVIDER` at `none` until Phase 2's release, and its photographs bucket and its FSM queue are not created (open points 32 and 33).

## P2-M3: referrals and the waitlist

Pincodes, a client's code, the invite and its preview image, attribution, the waitlist, the credit ledger, the first-fit grant with its fraud holds and ops' review, the pincode launch and the pre-January import (ADRs 0048 and 0033). The code is checked in `test/worker/referrals.test.ts`, `referral-grants.test.ts`, `referral-cards.test.ts` and `credit-bookings.test.ts`.

### The checks the prompt asks for

From `docs/prompts/phase2-backend.md`, P2-M3:

> - a referred consultation leads to a first fit that closes as done
> - both people are credited and the referrer is messaged
> - a same-address pair lands in review
> - after a revoke, a fresh share shows the house card

### How each is proven

The ground is laid once: `node scripts/import-pincodes.ts staging --all-served-from 2026-09-22` loads `data/pincodes/ncr-pincodes.csv` into `serviceable_pincodes` with every pincode served (run on 22 September 2026; run it again whenever the file changes). The referrer is a client who can sign in from the allowlisted handset, and their code is made the first time `GET /api/refer` is called with their session, since the app's Refer tab is P2-F3.

- [ ] **A referred consultation leads to a first fit that closes as done.** **Not yet run.**
  1. `GET /api/refer` gives the referrer's code; `SELECT code, card_state, card_version FROM referral_codes;` shows it as the house card at version 1.
  2. `GET /api/r/<code>` on `staging.maneman.in` answers valid, with the card to show, and the referrer's first name only if their latest consent to photographs on referral cards was given on the notice that says so (`photos-referral-cards-v2`) and `REFERRER_NAME_ON_INVITE` is on.
  3. `GET /api/pincodes/<pin>` answers served, with the area name.
  4. `POST /api/r/<code>/consultation`, with the friend's name, number, pincode, date, window, the contact-consent line and Turnstile's dummy token, books the consultation straight into the schedule, since self-serve booking is on (open point 41). `SELECT via, grant_state, consultation_appointment_id FROM referral_attributions WHERE code = '<code>';` shows `consultation`, `pending`, and the appointment.
  5. The friend's first fit is then booked and paid in the app (P2-M5, below) or by ops in FSM, and the technician closes it as Completed.
  - A correct result is `first_fit_appointment_id` filled by the five-minute referral pass, on a visit whose outcome is `done`.
- [ ] **Both people are credited and the referrer is messaged.** **Not yet run.**
  1. Within five minutes of the fit closing, the referral pass grants. The log line is `referrals_settled`, with `granted: 1`.
  2. `SELECT person_id, kind, visits, expires_at FROM credit_ledger WHERE source_kind = 'referral';` shows one grant of 3 visits to each side, expiring 365 days on, and `referral_attributions.grant_state` is `granted`.
  3. `GET /api/refer` shows the referrer's balance of 3 with its earliest expiry, and a tracker of completed fits only: the friend's first name and month, nothing else. `GET /api/me` shows the credit tile.
  4. `SELECT kind, state, sent_at FROM outbound_messages WHERE kind = 'friend_fitted' ORDER BY created_at DESC LIMIT 1;` is `sent`, and the handset has it. Its words are the placeholder `friend_fitted_v1` (open point 19).
- [ ] **A same-address pair lands in review.** **Not yet run.**
  1. Before the fit closes, give the friend the referrer's address: Profile → address (G1), or `PATCH /api/profile/address`, with the same first line and pincode.
  2. The pass then holds instead of granting: `grant_state` is `held` and `fraud_signals` holds `shared_address`. No credits are written and no message is queued.
  3. `GET /api/referrals/held` on `ops-staging.maneman.in` lists the pair with the rules it met.
  4. `POST /api/referrals/<id>/decision` with `{"decision":"approve"}` grants and messages as above; with `{"decision":"reject","reason":"…"}` it records the reason. Either way `SELECT action, subject_id FROM audit_log WHERE action = 'referral.decide' ORDER BY at DESC LIMIT 1;` holds the decision, under the member of staff who made it.
  - The other three rules (`shared_upi`, `monthly_cap`, `same_mobile`) are checked in `test/worker/referral-grants.test.ts`. `shared_upi` could also be shown on staging by paying both visits from the same test UPI handle.
- [ ] **After a revoke, a fresh share shows the house card.** **Not yet run.**
  1. `PUT /api/refer/card` with a 1200 x 630 JPEG under 300 KB, from a client who consents to photographs on referral cards: `card_state` becomes `personal` and `card_version` rises. On staging the file is composed by hand from that test client's own visit photographs; composing it in the browser is P2-F3.
  2. `GET /api/og/<code>.jpg?v=<version>` returns it.
  3. `DELETE /api/refer/card` revokes: `card_state` back to `house`, `card_version` up again, and `GET /api/og/<code>.jpg?v=<new version>` returns the house card. Switching the consent off in Profile takes the card down the same way.
  - A correct result is that the new version's link shows the house card. That is the whole point of the version: WhatsApp caches a preview by its URL, so a revoke reaches new shares only.

### Also to be proven with this milestone

- [ ] **The waitlist.** **Not yet run.** Set one pincode unserved for the test (`UPDATE serviceable_pincodes SET served = 0 WHERE pincode = '<pin>';`), then `POST /api/r/<code>/waitlist` with the required contact consent and the optional launch alert. `GET /api/waitlist` on the ops surface shows the pincode with its count, its longest wait, how many came through an invite and how many asked to be told. Restore the row afterwards.
- [ ] **The launch.** **Not yet run.** `POST /api/pincodes/<pin>/launch` with `{"confirm":false}` answers how many would be told; with `{"confirm":true,"launch_on":"<date>"}` it marks the pincode served and queues the alerts, ten a minute, to launch-consented entries only. `SELECT alerted_at FROM waitlist_entries WHERE pincode = '<pin>';` fills once, and the launch is audited as `pincode.launch`.
- [ ] **The back-fill import.** **Not yet run.** `node scripts/import-referrals.ts staging --file data/referrals/sample-referrals.csv` writes people, codes, attributions and credits from the synthetic sample; run again, it writes nothing twice. The real log is the owner's (open point 22) and is imported into production only.

### What staging cannot prove yet

- **The share itself.** The landing page at `maneman.in/r/:code` and the app's Refer screens (F1 to F6) are P2-F3 and do not exist. So the invite's chat renders on Android and iOS (boards B1 and B2), the card composed in the browser, and a friend's fresh share after a revoke cannot be checked end to end. Only the API's side of each is provable now.
- **The house card is a placeholder:** two tones and the gold rule, no photograph (open point 43).
- **Every pincode is served** on staging (open point 21), so "not served" has to be arranged by hand, and the real service area is not proven.
- **With self-serve booking off**, the landing would answer `409 ops_assisted` and a referred consultation would have to be recorded for ops instead. That is production's setting, and it is still open (open point 41).
- **The messages are placeholders** (open point 19), Evolution's delivery receipts are not set up on the shared instance (open point 18, runbook step 12), and only allowlisted numbers receive anything.
- **Ops' screens** (Ops Console C1 to C3) are P2-F3: the review queue, the referrers' funnel and the waitlist are proven as API calls only.

## P2-M5: self-serve booking and money

The price book, availability, holds, Razorpay Checkout, credit redemption, moving and cancelling under the 24-hour rule, refunds and late fees, all behind `SELF_SERVE_BOOKING` (ADRs 0045, 0046 and 0033). The code is checked in `test/worker/client-booking.test.ts`, `bookings.test.ts`, `visit-changes.test.ts`, `credit-bookings.test.ts` and `test/node/policy-moving-a-visit.test.ts`, and the app's own flow in `e2e/app/booking.e2e.ts` and `e2e/app/changes.e2e.ts` against a faked Checkout.

### The checks the prompt asks for

From `docs/prompts/phase2-backend.md`, P2-M5, whose staging proof "covers each consequence in design screens C4 to C8":

> - payment failed
> - hold expired
> - a move outside 24 hours carries the payment over
> - a cancel inside 24 hours loses the credit
> - a first-fit move inside 24 hours charges the late fee and carries the balance

### The staging proof, 23 September 2026

Run against Razorpay's **test** keys: no real money moved, and no real card was used. The two test clients are the ones P2-M2's proof made, both "Staging test" with random `9xxxxxxxxx` numbers; their sessions were written into `sessions` by hand, for the reason given in P2-M2 above.

**The client app cannot open Checkout, so none of the money screens could be driven through the app.** This is the proof's main finding, and it is set out first, because it changes how everything below was run.

- [ ] **The app's own booking screen pays for a visit.** **It does not.** Driven in Chromium at 390 px on a Pixel 7 profile against `https://app-staging.maneman.in`, the flow is right up to the moment of paying: Visits → Book your next visit → "Pick a date" → "Pick a window" → "Pay and confirm", with `POST /api/holds` at 4.3 s and `POST /api/bookings` at 5.4 s, the sheet reading "Slot held 10:00", "Service visit", "Thu 24 Sep, 4 to 8 pm", "Rs. 2,000", "Rs. 2,000 incl. GST" and "Free to move until 4 pm, Wed 23 Sep. After that it is charged."
  - Pressing **Pay Rs. 2,000** creates Razorpay's Checkout window, and it is **invisible and untouchable**. Asked in the browser at that moment: the Checkout iframe is `390 × 844 at 0,0`, `visibility: visible`, `z-index: 2`; the booking sheet is `:modal`; and `document.elementFromPoint` at four points down the middle of the screen returns the sheet or its children every time, never the iframe.
  - The cause is in `apps/app/src/booking/BookingSheet.tsx`: the sheet is opened with `showModal()` and stays open while `pay()` runs. A modal `<dialog>` is promoted to the browser's top layer, above every z-index, and everything outside it is inert. Checkout is drawn underneath it and takes no taps. So a client cannot enter a card or a UPI ID, and no visit can be paid for in the app.
  - `e2e/app/booking.e2e.ts` did not catch it because it replaces Checkout's script with one that pays or fails at once (`e2e/app/checkout-fakes.ts`), so no window is ever created.
  - **Fixed** in this branch: the sheet closes while Checkout is up and rises again with its answer, and a `paying` flag keeps that close from letting the hold go. `e2e/app/booking.e2e.ts` › "lets Checkout's own window through, in front of the sheet" now paints a window of Checkout's own and asserts that the page lets it to the front; it fails without the fix. **The fix is not on staging**: it needs a deploy of `mm-app`, and this proof left staging on the pipeline's version. The check stays unticked until the owner sees it work on the deployed app.

Everything below was therefore run against the same API the app calls, with the same session, and Checkout was opened on a bare local page carrying the order our `POST /api/bookings` returned. The money, the orders, the webhooks and the rows are real; only the screen around Checkout was not the app's.

Razorpay's test account offers Cards, EMI, Netbanking, Wallet and Pay Later in Checkout. Netbanking ends at Razorpay's simulated bank page, whose **Success** and **Failure** buttons decide the outcome, so it is what the checks below used.

- [x] **Payment failed (C6).** Two attempts were made to fail, and both did. A test card through 3-D Secure failed at **08:17:07**, and netbanking's simulated **Failure** at **08:22:07**; Razorpay's `payment.failed` reached `POST /api/hooks/razorpay` 1.0 s and 4.6 s later. Each wrote a `payments` row with `status` `failed`, method `card` and `netbanking`, amount 200000, the person matched, no reference and no appointment. The next attempt, on a fresh hold and with the simulated bank's **Success**, was captured and booked the visit (below); paying again on the _same_ hold is what the app's C6 screen would do, and that could not be driven. `GET /api/payments` lists neither failure: the client sees only the capture.
  - The columns are `status` and `amount`, not the `state` this section guessed at.
  - **What is not proven** is C6 itself: the app's failed state, with the hold still counting and "Another method", could not be reached, for the reason above.
- [x] **Hold expired (C6).** A first-fit hold was taken at **08:39:57** and left. Its `expires_at` was **08:49:57.895**: ten minutes to the second. At 08:48:42 `GET /api/holds/{id}` still said `state: "held"`; at **08:50:11** it said **`state: "expired"`**, with `paid: false` and `visit_id: null`. `POST /api/bookings` on it then answered **`409 hold_expired`**.
  - In the database the row still reads `state: 'held'`, with `appointment_id` and `refunded_at` null and no order: the lapse is worked out from `expires_at`, not stored, and the CHECK on that column allows only `held`, `booked` and `released`. There is no `booked_at` column, as this section supposed.
  - **What is not proven** is the page: C6's countdown reaching zero and offering the windows again could not be seen, for the reason above. Nor was the other half of ADR 0045 — a capture arriving after the hold has lapsed, refunded in full and claimed on the hold so a repeat cannot refund twice — which needs a payment made and left to settle past ten minutes; it is covered by `test/worker/bookings.test.ts`.
- [x] **A move outside 24 hours carries the payment over (C7).** On the visit paid for at 08:24 (2026-09-27, evening), `POST /api/appointments/{id}/reschedule` with `{}` answered `notice: "free"`, `free_until` 2026-09-26T06:30Z, `paid: 200000`, `cost: "free"` and a price of 0. `GET /api/availability?type=service&moving=…` priced the move at 0 and named the regular technician; the hold for 2026-09-29 morning was priced at 0; the confirmation answered **201 with `checkout: null`**.
  - Afterwards the FSM appointment kept its ID `8229000000304341` and its work order `8229000000306229`, with new times (FSM's AP-16 now reads 2026-09-29 09:00 to 10:30 India time); the mirror's `window_start` moved from 2026-09-27T06:30Z to 2026-09-29T03:30Z; and the payment is still the visit's.
  - `visit_changes` holds `kind: moved`, `notice: free`, `was_start` 2026-09-27T06:30Z, `now_start` 2026-09-29T03:30Z, `refund_amount` 0, `kept_amount` 0, `payment_id` null. The columns are `refund_amount` and `kept_amount`, not the `refunded_paise` and `kept_paise` this section guessed at, and `payment_id` is null because a free move takes no payment.
  - A `reschedule_confirmation` was queued at 08:25:39.165 and **skipped**, "number not on the allowlist" — as was a `payment_receipt` at 08:24:07.328 when the visit was booked. Both would reach a handset on the allowlist.
- [x] **A cancel inside 24 hours loses the credit (C8).** Three credits were granted as ops would (`credit_ledger`, kind `grant`, source `ops`). The hold for a service visit then carried `credit: { remaining: 2 }`, `POST /api/bookings` answered `checkout: null`, and once the visit existed a `redeem` of −1 was written against the grant that expires soonest, with the appointment as its source.
  - Ops moved that visit inside 24 hours in FSM (to 2026-09-24 09:00 India time); the mirror had it 9 s later.
  - `POST …/cancel` with `{"confirm":false}` answered `notice: "late"`, `credit: "lost"`, `refund: 0`. Confirming with `{"confirm":true,"notice":"free"}` — the terms as they had been — answered **`409 terms_changed`** and changed nothing. Confirming with `"late"` answered 200, `cancelled: true`.
  - A correct result, and what happened: **no `restore` row**, and `visit_changes` recording `cancelled` at `late` notice.
  - **The pairing that makes it mean something:** a second visit was booked on another credit and cancelled more than 24 hours out. There the terms said `credit: "restored"`, and a `restore` of +1 was written against the same grant. The ledger reads grant +3, redeem −1, redeem −1, restore +1: a balance of 2.
- [x] **A first-fit move inside 24 hours charges the late fee and carries the balance (C7).** A first fit was booked and paid for at **08:33**: `MM-2026-0002`, 3000000 paise, the price book's ₹30,000. Ops then moved it in FSM to 2026-09-24 09:00 India time, and the mirror had it 8 s later.
  - `POST …/reschedule` with `{}` then answered `notice: "late"`, `cost: "late_fee"` and a price of **400000 paise** — the price book's `late_fee_first_fit`, ₹4,000. Asked before the mirror had caught up, the same call answered `free`, which is correct and worth knowing: the terms follow the copy, not FSM.
  - The hold for the new window carried `late_fee: { amount: 400000 }` and an amount of 400000; the confirmation answered 201 with a Checkout order for ₹4,000, described "Moving your first fit to 2026-09-30"; it was paid through Checkout at **08:39**.
  - The visit kept its FSM appointment ID `8229000000306278` and its technician, and moved to 2026-09-30. `GET /api/payments` shows both entries, each saying what it paid for: `MM-2026-0002`, 3000000, purpose `visit`; and `MM-2026-0003`, 400000, purpose `late_fee`, with `charge` `{"change":"moved","amount":400000,…}`.
  - `visit_changes` holds `kind: moved`, `notice: late`, `kept_amount` 400000, and the late fee's `payment_id`.

### Also proven with this milestone

- [x] **A refund reaches its source and is recorded in Books.** The visit paid for at 08:24 was cancelled more than 24 hours out at **08:40**. The terms answered `refund: 200000`, `kept: 0`, `destination: "netbanking"`, and confirming answered `cancelled: true`.
  - Razorpay made the refund at **08:40:13**: `rfnd_TfPpO5sDZySmbk`, 200000 paise, `speed_processed` normal, status `processed`, with notes naming the appointment and "cancelled by the client".
  - Our `refunds` row followed from Razorpay's webhook, and the five-minute pass recorded it in Books as `4242595000000072002`, from `BOOKS_REFUND_ACCOUNT_ID` (open point 39). The payment is now `refunded` with `refunded_amount` 200000.
  - `GET /api/payments` shows the refund entry with `destination: "netbanking"` and `speed: "normal"`, above the payment it came from.
- [ ] **With `SELF_SERVE_BOOKING` off, booking, reschedule and cancel answer `409 ops_assisted`,** and the app opens WhatsApp to ops with the visit named. **Not run.** It needs a staging version deployed with the flag off and staging then put back on the pipeline's version, and staging was shared with two other proofs that morning. The refusal itself is `{"error":{"code":"ops_assisted",…}}` from the middleware in `src/routes/client-booking.ts`, and it is covered by `test/worker/client-booking.test.ts` and `visit-changes.test.ts`.

### What the proof found

- **The app cannot open Checkout**, so no visit can be paid for in the client app at all. It is the first thing to fix, it is fixed in this branch, and it needs a deploy of `mm-app` to staging before anyone can say the app's own money screens work. Until then the C6, C7 and C8 screens are unproven, whatever the API underneath them does.
- **The screens the app draws before paying are right**, at 390 px: the price, the inclusive figure, the ten-minute countdown, "Free to move until …", and the two methods.
- **Razorpay's webhook is already live on staging** and answered every event we needed — authorised, captured, failed, and a refund — so open point 5 is done for staging.
- **Zoho's auth quota reaches into the money.** While FSM could not be reached, three paid bookings were refunded after five attempts (open point 62). Nothing in this proof's own bookings was lost, but the rule is worth a ruling.

### What staging cannot prove yet

- **No real money.** Test keys only; KYC, live keys and a live webhook wait for production (open point 6). Netbanking's simulated bank page is what decided each outcome, so nothing here says how a real bank or a real UPI app behaves.
- **Nobody signed in**, as in P2-M2: the sessions were written by hand, so the login the client would use is not part of these results.
- **The figures are the design's.** Prices, the late fees, the late-cancel refund and the change copy are placeholders, or our reading of the rule, and the owner has still to confirm them (open points 1 and 7). The design does not draw the way from C7 to C8 either. What the proof does show is that the figures the app and the API use are the price book's: ₹2,000 a service visit, ₹30,000 a first fit, ₹4,000 the first fit's late fee.
- **GST is 0%.** The app shows the ex-GST figure as the main number with the inclusive figure beside it; with GST off the two are equal, so the proof shows the plumbing, not the arithmetic (open points 2 and 3).
- **No refund voucher.** Books gives no PDF for a refund that we have found, so the entry carries its destination and a **Notify me** that asks ops on WhatsApp (open point 35).
- **Self-serve is on in staging and off in production** (open point 8), so what production will do is only ever shown by turning the flag off deliberately.
- **A move to another technician** is dispatch's, in P2-M4, and there is one technician on staging in any case (open point 12).

## What these two proofs left in the owner's org

Staging shares the real Zoho org (open point 10), so the records below are real and are the owner's to keep or clear. Every one of them is labelled "Staging test". Nothing was deleted, because two of them are still wanted: **WO13 is the work order the invoice check waits on**, and the first fit is the visit a move was proven on.

**Zoho FSM.** Two contacts, `8229000000305231` and `8229000000304356`, both "Staging test" with random numbers. Two Requests, `8229000000304279` (REQ4, left at "Work In Progress" with no work order, for the reason in open point 61) and `8229000000306245`. Five work orders with an appointment each:

| Work order       | Appointment      | What it is                           | Left as                        |
| ---------------- | ---------------- | ------------------------------------ | ------------------------------ |
| 8229000000305234 | 8229000000304285 | The service job, with 10 photographs | **Closed, "Not yet Invoiced"** |
| 8229000000306229 | 8229000000304341 | The paid service visit, then moved   | Cancelled, refunded            |
| 8229000000305384 | 8229000000306251 | A credit booking, moved by ops       | Cancelled at late notice       |
| 8229000000306269 | 8229000000304388 | A credit booking                     | Cancelled at free notice       |
| 8229000000305397 | 8229000000306278 | The first fit, moved at a late fee   | **Scheduled, 30 September**    |

**Zoho Books.** Three customer payments — `4242595000000067002` (₹2,000), `4242595000000069003` (₹30,000) and `4242595000000071002` (₹4,000) — and one refund, `4242595000000072002` (₹2,000), each described "Staging test: Razorpay …". None is applied to an invoice, because no invoice exists.

**Razorpay** holds the test-mode orders, payments and the refund. They are test data and need no clearing.

## P2-M6: DPDP readiness

Erasure reaching Phase 2's data and the FSM contact, the client's own export, grievances, the retention jobs and a breach runbook (ADR 0049, on top of ADR 0019's erasure). The code is checked in `test/worker/dpdp.test.ts` and `erasure.test.ts`.

### The check the prompt asks for

From `docs/prompts/phase2-backend.md`, P2-M6:

> **P2-M6 — DPDP readiness** (roadmap Stage 4, before 14 May 2027): access and deletion requests end to end, retention jobs verified, and a breach runbook.

### How each is proven

- [ ] **An access request, end to end.** **Not yet run.** In the app: Profile → Your data → download. Through the API: `GET /api/me/export` returns `maneman-my-data.json`. A correct result holds that client's details, addresses, consents with their notice versions, visits, payments, refunds, credits, referral code, the messages sent to them (kind and date only), grievances and try-ons, and nothing of anyone else's. `SELECT action, actor_kind FROM audit_log WHERE action = 'data.export' ORDER BY at DESC LIMIT 1;` records it under the client.
- [ ] **A grievance, end to end.** **Not yet run.** Profile → Your data → raise a concern (`POST /api/grievances`). Ops are alerted by ID only, never with the client's words; `GET /api/grievances` on `ops-staging.maneman.in` lists the open ones, and `POST /api/grievances/{id}/resolve` closes one with its answer. Both are audited (`grievance.raise`, `grievance.resolve`).
- [ ] **A deletion request, end to end.** **Not yet run.**
  1. The client asks in the app: Profile → Request deletion (`POST /api/deletion-request`), audited as `deletion.request`. Asking twice makes no second request.
  2. `GET /api/deletion-requests` on the ops surface lists it; `POST /api/deletion-requests/{id}/decision` with `{"decision":"delete"}` runs the erasure itself, audited as `deletion.decide`. (`node --env-file=.env.erasure-staging scripts/erase-person.ts --environment staging` is the same erasure from the other end, for a request that arrives on WhatsApp.)
  3. A correct result, checked as the runbook's "Erasure within the day" sets out: the try-on photographs and results gone from R2; the visit photographs gone from `mm-staging-client-photos`, and their rows with them; saved addresses and number-change requests gone; a grievance's words blanked; the person blanked and their number replaced; sessions ended; unsent messages skipped; withdrawal consents written; and the visits, payments, refunds, credits and the Books invoices kept, as records.
  4. `SELECT erased_at, crm_erased_at, fsm_erased_at, fsm_erasure_attempts FROM people WHERE id = '<person_id>';` fills all three within a few minutes: the CRM record blanked by the crm-sync queue, and the FSM contact's name, numbers, e-mail and street overwritten by the fsm-sync queue, its city left for the records.
  5. The Worker's logs from before the request hold neither the number, in either form, nor the name.
- [ ] **The retention jobs.** **Not yet run.** Nothing waits 7 days or 365 in a proof, so each is shown by back-dating a row on staging, as Phase 1's download-failure drill was arranged:
  - **The 7-day window.** A deletion request back-dated 5 days makes the next cron alert ops once (`alertAgedDeletions`), and it is not alerted twice.
  - **Credit expiry.** A grant back-dated past its expiry is closed by the referral pass with one `expire` entry for what is left of it, and the balance in `GET /api/me` drops. A second pass writes nothing.
  - **The clawback.** A granted first fit refunded in full has both sides' remaining credits clawed back on the same pass.
  - **Try-on retention.** Uploads expire after an hour and results after 30 days, on the sweeper (ADR 0039); a back-dated row proves each on staging.
- [ ] **The breach runbook.** **Not yet run.** `docs/runbook.md`, "A personal data breach": contain within the hour, keep the evidence, assess, notify the Data Protection Board and each person affected, record. It is walked through as a table-top exercise against one scenario, a leaked Worker secret, checking that each command in step 1 works on staging: `W secret put …`, revoking a Zoho, Razorpay or Evolution key in its console, signing an ops user out of Cloudflare Access, and `UPDATE sessions SET revoked_at = …`.

### What staging cannot prove yet

- **Nobody to notify.** No Grievance Officer is named, the 30-day answer time in the app is a placeholder, and the breach runbook's contacts are missing (open point 42). The notification steps can be rehearsed, but they are addressed to no one.
- **The app's copy is a placeholder.** The design draws no "Your data" card, so its words are ours until the owner approves them (ADR 0049, open point 20).
- **Deletion in FSM is anonymisation, not deletion.** The contact stays, with its name, numbers, e-mail and street cleared and its city kept (ADR 0049). Zoho's own timeline may still hold the old values, as the CRM's may; that is open for legal (ADR 0019).
- **The 8-year invoice retention** cannot be shown, only stated: nothing deletes an invoice, and Books holds them.
- **Deletion within 7 days in production** is not proven by a staging run. Production holds its FSM, Books and payments providers at `none` until Phase 2's release, so an erasure there reaches fewer places today than it will.
