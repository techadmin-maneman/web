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

It was written before the event. **P2-M3 and P2-M6 have since been run**, on 23 September 2026, and their two sections below are records of what was seen, ticked where it was observed. Everywhere else nothing has been observed: each check is left unticked and marked **not yet run**, and where it names a figure, a screen or a log line, that is what a correct result looks like, not what was seen.

| Milestone | What it covers                                                                                                                                                  | Merged in                                                   |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| P2-M2     | The FSM and Books connection, the mirror, the reconciliation, visit photographs, the payments mirror, Books receipts, and booked leads into FSM                 | PRs #41 to #46, #49 and #54; the app's read surfaces in #48 |
| P2-M3     | Pincodes, referral codes, the landing's APIs, the waitlist, the credit ledger, the grant, fraud holds, ops' review, the cards, the preview image and the import | PR #62                                                      |
| P2-M5     | The price book, availability, holds, Razorpay Checkout, credit redemption, moving and cancelling under the 24-hour rule, refunds and late fees                  | PRs #50, #51 and #55, with #63; the app's booking in #52    |
| P2-M6     | Erasure reaching Phase 2's data and FSM, the client's own export, grievances, the retention jobs and the breach runbook                                         | PR #62                                                      |

### How every proof below is run

- **Access.** Every staging host is behind Cloudflare Access (runbook, step 11). A script gets through with the `mm-ci-staging` service token in `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`; a person gets through with the founders' login. Only `/api/hooks/` and `/api/result/` bypass it, and each checks its own secret (runbook, steps 10 and 12).
- **The hosts** are `https://staging.maneman.in` (public), `https://app-staging.maneman.in` (client) and `https://ops-staging.maneman.in` (ops), all four surfaces switched on since 22 September 2026 (`src/config/environments.ts`). `npm run smoke -- --environment staging --surfaces` says whether each host answers before anything else is tried.
- **A handset on the allowlist.** A client signs in with a six-digit code on WhatsApp; SMS is off (`SMS_PROVIDER` is `none`, open point 17) and staging sends only to its allowlist. So every proof that needs a login, or a message, needs a test handset whose number is on that allowlist.
- **Ops' screens.** The ops console is on `ops-staging.maneman.in` since P2-F4, with Dispatch, Clients, No-shows, Referrals, Waitlist, Tasks and Technicians. Where a check is about an ops action one of those covers, it is done on the screen; everything else — grievances, deletion requests, number changes — is an HTTP request to the same host through Access. A script reaches either with the `mm-ci-staging` service token, so an action it takes is audited under that token's name, not a founder's.
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

### How each is proven

- [ ] **A staff-run job in the FSM trial org appears in `/visits` with its five-angle before-and-after set.** **Not yet run.**
  1. **A client who can sign in.** Book a consultation from the allowlisted handset on `https://staging.maneman.in/book`. (The **staging-lead** workflow — Actions → staging-lead → Run workflow, with a city and window — books through `scripts/staging-lead.ts` with a random number, which no one can sign in as, so it proves the lead path but not this one.) Within a minute `SELECT id, fsm_request_id FROM leads ORDER BY created_at DESC LIMIT 1;` holds a Request ID, and FSM shows a Request whose summary begins "Staging test:".
  2. **Ops schedule it in FSM.** Convert the Request to a work order, schedule the appointment and assign the technician. FSM's workflow rule posts to `POST /api/hooks/fsm/<token>`; the log shows `fsm_hook_taken`, then `fsm_synced` from the `mm-fsm-sync-staging` consumer. `SELECT fsm_id, type, status, window_start, technician_id, person_id FROM appointments ORDER BY synced_at DESC LIMIT 1;` shows the appointment matched to the person by mobile number.
  3. **Run the job in FSM's own app.** Our technician app is P2-M4, so the technician works in FSM: start the job, attach ten photographs named `before-front.jpg`, `before-top.jpg`, `before-left.jpg`, `before-right.jpg`, `before-hair.jpg` and the same with `after-`, and close the appointment as Completed (runbook, step 11b, point 6).
  4. **The mirror copies them.** The next hint writes the visit and copies the attachments into `mm-staging-client-photos` under `visits/<appointment>/`. `SELECT ps.phase, COUNT(*) FROM photos p JOIN photo_sets ps ON ps.id = p.photo_set_id GROUP BY ps.phase;` gives 5 and 5. A photograph attached later is picked up by the hourly retry, which looks again at visits closed in the last three days that are still short of ten.
  5. **Read it as the client.** Sign in at `https://app-staging.maneman.in`, then Visits → the past visit (board C9): what was done, the duration, the technician's name and initials, and both sets; Photos (D1) shows the five angles. The same through the API: `GET /api/visits/{id}` returns `photo_set.before` and `photo_set.after` with the angles in the order front, top, left, right, hair, each link lasting 15 minutes and refused to any other session.
  - A correct result is five before and five after, the visit's outcome `done`, and no photograph reachable without that client's session.
- [ ] **The invoice PDF opens.** **Not yet run.**
  1. In FSM, raise the invoice on the closed work order. FSM and Books are linked and sync every two to three hours (open point 38), so the invoice reaches Books on its own.
  2. `SELECT fsm_invoice_id FROM appointments WHERE fsm_id = '<id>';` holds the invoice once the mirror has read it.
  3. In the app: Payments → the entry (E2) → **Tax invoice**. Through the API: `GET /api/documents/{id}` streams the PDF from Books. A payment's receipt is `GET /api/payments/{id}/receipt`, Books' own receipt (ADR 0044, "Receipts in Books").
  4. A document Books has not finished answers `not_ready`, and the app shows E3's "The invoice is still generating" with **Notify me**.
  - A correct result is a PDF that opens and names the visit. With GST off it carries no tax, and its figures are the placeholder prices (open points 1, 2 and 3).
- [ ] **A deliberately broken webhook is repaired by the nightly reconciliation.** **Not yet run.**
  - The reconciliation is not only nightly: it runs with the sweeper every five minutes over the 50 appointments FSM changed most recently, and walks the whole list overnight between 1 and 5 am India time (ADR 0032). Both parts are proven, and the departure from the prompt's word is recorded here.
  1. **Break it.** In FSM, Setup → Automation → Workflow Rules, deactivate the rule that calls the webhook "Mane Man mirror staging" (open point 16).
  2. **Change the appointment in FSM**: move its window, or close it.
  3. **Show the mirror is stale.** `SELECT fsm_modified_at, synced_at, window_start FROM appointments WHERE fsm_id = '<id>';` still holds the old values, and `SELECT COUNT(*) FROM webhook_inbox WHERE record_id = '<id>';` has not grown.
  4. **Wait one five-minute run.** The log shows `fsm_reconciled` with `queued: 1`, then `fsm_synced` for that appointment, and the copy's `window_start` and `fsm_modified_at` now match FSM's.
  5. **Then the night.** Break it again and leave it past 1 am India time: the overnight pass reads a page a run, and at the end of the pass alerts once with `fsm_drift_repaired` and what it repaired. A copy less than ten minutes behind FSM is not counted, since its hint may still be on the way.
  6. **Switch the workflow rule back on**, and check that the next change arrives by hint again (`fsm_hook_taken`).

### Also to be proven with this milestone

The prompt lists three checks; the milestone also carries the payments mirror and the leads into FSM, and neither has been seen on staging either.

- [ ] **A test payment reaches the mirror from Razorpay's webhook.** **Not yet run.** Pay in Razorpay test mode (P2-M5's booking, below), then `SELECT reference, state, method, amount_paise FROM payments ORDER BY created_at DESC LIMIT 1;` holds a reference of the form `MM-2026-0841`, and `razorpay_events` holds the event once. A repeat of the same event changes nothing.
- [ ] **The payment is recorded in Books, and its receipt opens.** **Not yet run.** The five-minute cron records it against the client's Books customer once FSM's sync has created that customer, which can take up to three hours (ADR 0044). `GET /api/payments/{id}` then carries the receipt's ID, and `GET /api/payments/{id}/receipt` streams it.
- [ ] **A booked lead reaches FSM as a Request.** **Not yet run.** As in step 1 above: `leads.fsm_request_id` marks it sent, and the Request's note carries the window in words.

### What staging cannot prove yet

- **The prices and the tax.** FSM's service items were created at the design's placeholder prices (ADR 0032), and GST is 0% in the price book and off in Books (open points 1, 2 and 3). An invoice or a receipt proves the path, not the figure. The invoicing route itself waits on the CA's answers.
- **The photographs are FSM's.** Until our technician app (P2-M4), a set depends on the technician naming files by phase and angle, and FSM's app uploads them at full size, several megabytes each (open point 34). The job-sheet template is a placeholder (open point 13), so `visits.partial_reason` stays empty and a partial outcome cannot be proven with its reason.
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

### Staging proof, 23 September 2026

Run against staging on Worker version `f6d314a9-767b-4280-bc5b-3c03903ea496`, which is what the pipeline had deployed; nothing was deployed for this proof. `npm run smoke -- --environment staging --surfaces` passed first, twelve checks over `app-staging`, `ops-staging` and `tech-staging`, and the five against `staging.maneman.in` passed too. Times are Cloudflare's (UTC), from D1, Workers Logs and the two consoles.

The ground was already laid: `serviceable_pincodes` holds 198 rows, every one served, launched 21 September 2026.

Four test people were made for this proof, each named "Staging test" with a random `9xxxxxxxxx` number: a referrer and three friends. **None of them signed in.** A login code goes out on WhatsApp and staging sends only to its allowlist, so for each test person a client session row was written into `sessions` by hand — the same row `openSession` writes, the SHA-256 of a random token. The login is not proven here; it belongs with the client app. Everything after the session is the real API, the real landing and the real ops console.

- [x] **A referred consultation is booked through the invite.**
  1. The referrer was made by booking a consultation on the site itself, `POST /api/consultation` at 07:46:26 (Janpath, 110001, 24 September, morning): 201, and the fsm-sync consumer booked it into FSM 7 s later as appointment `8229000000304263`.
  2. `GET /api/refer` with the referrer's session gave code **STE2V4** and the link `https://staging.maneman.in/r/STE2V4`, balance 0, card `house` at version 1, nobody fitted. `SELECT code, card_state, card_version FROM referral_codes;` agreed.
  3. `GET /api/r/STE2V4` on `staging.maneman.in` answered `valid`, card house at version 1, and `referrer_first_name: null` — correct, because the referrer had not yet agreed to photographs on referral cards. Once that consent was switched on, the same call named them "Staging". Each call raised `referral_codes.opens`.
  4. `GET /api/pincodes/110001` answered served, area "Janpath", city Delhi; `400001` answered `served: false` with a null area; `999999` was refused `400 invalid_request`, field `pin`.
  5. `POST /api/r/STE2V4/consultation` answered **201** each time it was used, with the date, the window, the area and `credits: true`. `SELECT via, grant_state FROM referral_attributions WHERE code = 'STE2V4';` showed `consultation` and `pending` for each friend.
- [ ] **The referred consultation reaches FSM.** **Failed, and fixed in this pull request.**
  - Every consultation booked through the invite failed to reach FSM. The log line is `booking_failed … "reason": "the person has no city to give FSM"`, first at 07:50:32 and again on each of the five attempts; the fsm-sync consumer then gave the slot back, and the hold went from `held` to `released`. The friend had a place in D1 and no visit anywhere else.
  - The cause is ours. `fsmContactOf` reads the contact's city from the person's saved address, else from their latest lead. A friend who arrives through an invite has neither: the landing never asks where the hair loss is, so their booking leaves no lead at all (open point 50), and they have saved no address yet. The one place the city is known — the pincode they booked at — was not read.
  - Proven by arranging the opposite: a third test friend was given an address through `PATCH /api/profile/address` and booked again, and `create_contact` then answered 201 with the contact kept on the person.
  - **The fix** is in `src/domain/fsm-contacts.ts`: the city falls back to the city of the pincode on the person's referral attribution. `test/worker/referrals.test.ts` › "reaches FSM, using the invite's pincode for the city the friend's booking never asks for" fails without it. It is **not yet proven on staging**, because staging was carrying other proofs at the same hour and deploying under them would have disturbed them. What would prove it: deploy this commit to staging and book one consultation through an invite from a number with no address, then see `create_contact` and `fsm_synced` instead of `booking_failed`.
- [x] **A first fit that closes as done leads to the grant.** The closing itself was arranged, not run.
  - Closing a job in FSM is P2-M2's and P2-M4's path, and `visits` is only ever written by the FSM mirror. Two first-fit appointments (`staging-proof-m3-fit-a` and `-fit-b`, status `completed`) and their two visits (outcome `done`) were therefore written into D1 directly, and the real five-minute cron did the rest. So what is proven here is the referral pass, not the mirror.
  - At **08:00:54.999** the pass logged `referrals_settled` with `granted: 1, held: 1, invites_expired: 0, credits_expired: 0, clawed_back: 0`, and filled each attribution's `first_fit_appointment_id`.
- [x] **Both people are credited.**
  - `SELECT person_id, kind, visits, expires_at FROM credit_ledger WHERE source_kind = 'referral';` holds one grant of **3 visits** to the friend and one to the referrer, both created 08:00:51.734 and both expiring **2027-09-23T08:00:51.734Z**, exactly 365 days on. The attribution is `granted`.
  - `GET /api/refer` then showed `visits: 3` with that expiry, and a tracker of one entry: the friend's first name and `2026-09`, nothing else. `GET /api/me` carried the same credit tile. The app's own Refer tab (F1) at 390 px reads "When a friend you refer is fitted, you both get 3 service visits free.", "Your credit", "Expire 23 Sep 2027", "3"; "See who has been fitted" (F5) lists the friend with "Fitted Sep 2026" and "3 visits earned", under "Completed fits only. Whether an invite was opened is your friend's business."
- [ ] **The referrer is messaged.** **Needs the owner's handset.** The message was made and queued as the grant was written: `SELECT kind, state FROM outbound_messages WHERE kind = 'friend_fitted';` is one row, `friend_fitted`, state **`skipped`**, `last_error` "number not on the allowlist", 0 attempts. That is correct for a random test number. What would prove it: run the same grant with the referrer's number on `MESSAGING_ALLOWLIST`, and see the state `sent` and the placeholder `friend_fitted_v1` text on the handset (open point 19).
- [x] **A same-address pair lands in review, and ops decide it on the real screen.**
  - The second friend's address was saved through `PATCH /api/profile/address` with the referrer's own first line and pincode. The same 08:00:54 pass held that grant instead of granting it: `grant_state` `held`, `fraud_signals` `["shared_address"]`, no credit row and no message.
  - The ops console's **Referrals** section at `ops-staging.maneman.in/referrals` showed "Held for review 1", the pair as "Staging test → Staging test", "Fitted Wed 23 Sep", the rule lettered **SAME ADDRESS**, and Approve and Reject. Under it, "All referrers": Opens 4, Consults 3, Fits 2, Granted 1, Redeemed 0.
  - **Approve** asked for a reason first ("Why you are approving it — Kept with the decision, in the audit log") and only the second press sent it. `POST /api/referrals/31205e1a…/decision` answered 200, the queue emptied, and D1 holds `grant_state` `approved` with `reviewed_by`, `review_reason` and `reviewed_at`. `SELECT action, subject_id FROM audit_log WHERE action = 'referral.decide';` holds the decision. Both sides then had a second grant of 3 visits, written 08:02:38.527.
  - **Who the audit names.** The console was reached with the `mm-ci-staging` service token, so the decision is recorded under that token's name, not a founder's. A member of staff signing in with their own Access login would be named instead; that half is not proven here.
  - **A small defect:** after a decision the "All referrers" panel is not read again. It still said Granted 1 until the page was opened afresh, when it said 2. Nothing is wrong in the data.
  - The other three rules (`shared_upi`, `monthly_cap`, `same_mobile`) are still only in `test/worker/referral-grants.test.ts`.
- [x] **After a revoke, a fresh share shows the house card — and so does an old one.**
  1. A 1000 × 600 JPEG was refused `422 photo_invalid_file`. A **synthetic** 1200 × 630 JPEG of 7,687 bytes — three flat colour bands, no photograph of anyone — was accepted: `{"version": 2}`, `card_state` `personal`.
  2. `GET /api/og/STE2V4.jpg?v=2` returned exactly those 7,687 bytes, byte for byte the same SHA-256, as `image/jpeg` with `Cache-Control: public, max-age=86400`. The landing's own tags then read `og:image … /api/og/STE2V4.jpg?v=2` and `og:title "Staging sent you a Mane Man invite"`, rewritten by `mm-site` from the invite, so a crawler that runs no JavaScript sees them.
  3. `DELETE /api/refer/card` answered 204: `card_state` back to `house`, version 3, `card_key` cleared. `GET /api/og/STE2V4.jpg?v=3` answered **302 to `/images/invite-house.jpg`**.
  - **More than the prompt asks.** `?v=2`, the old share's own link, also answers 302 to the house card, because the revoke deletes the stored object as well as moving the version on. So a revoke reaches old shares too, as soon as WhatsApp fetches the preview again, and the version only decides how soon. The record until now said a revoke reached new shares only.
  - Switching the consent off does the same: the card was uploaded again (version 4), `PATCH /api/consents/photos_referral_cards {"granted": false}` took it down (version 5, `house`), and the invite stopped naming the referrer.

### Also proven with this milestone

- [x] **The waitlist.** `110004` (Rashtrapati Bhawan) was set unserved for the test. `POST /api/r/STE2V4/waitlist` answered 201 with the area and `credits: true`; a second person joined through the site's own `POST /api/waitlist` without the launch alert; and `POST /api/r/STE2V4/consultation` on that pincode was refused `422 not_bookable`. The ops console's **Waitlist** section showed one row: `110004  Rashtrapati Bhawan  Count 2  Oldest 23 Sep  Ref 1  Alerts 1`.
- [x] **The launch, from the console.** Choosing the pincode only asked what a launch would send: "This messages 1 person", On the list 2, Opted in to alerts 1, Held referral invites 1, the placeholder text itself, and the note "The 1 who did not opt in are not messaged." The second press launched it: "Launched. 1 on their way." `serviceable_pincodes` has `served = 1` and `launched_at` 2026-09-22T18:30:00Z (today, in India); `waitlist_entries.alerted_at` filled at 08:04:21.879 for the one entry that asked to be told and stayed null for the other; and `audit_log` holds `pincode.launch` on subject `110004`. The alert itself is `launch_alert`, state `skipped`, "number not on the allowlist". The pincode was put back as it was afterwards.
- [x] **The back-fill import.** `node scripts/import-referrals.ts staging --file data/referrals/sample-referrals.csv` wrote "3 referrals into staging": `referral_codes` 3, `referral_attributions` 7, `credit_ledger` 10 of which 6 came from the import — four grants of 3 visits each, and two `adjust` rows of −1 and −2 for the credits the log says were already used. Run a second time it wrote nothing: every count was the same. The real log is the owner's (open point 22).

### What this proof found

- **An invited friend's consultation never reached FSM** (above): fixed here, not yet re-proven on staging.
- **`referral_attributions.consultation_appointment_id` was never written by anything.** The column has existed since migration 0021 and no code filled it, so ops' record did not name the consultation an invite produced. `confirmBooking` now fills it when it books a consultation, and `test/worker/referrals.test.ts` checks it.
- **The invite publishes prices the price book does not hold.** The landing at 390 px offers "First fit, from … Standard base ₹25,000" and "Service visit … ₹1,500". The price book has held ₹30,000 and ₹2,000 since 22 September (`SELECT item, amount_ex_gst, valid_from FROM price_book;`), which is what the app charges. The figures come from `site/src/content/site.ts` and nobody reconciles them. This is exactly the risk open point 44 names, on the first page a friend sees.
- **Zoho's token budget is one budget for every proof.** From 07:55 the FSM calls began failing with `Zoho 400 Access Denied: could not refresh the access token`, straight after a `401` on a call the same token had just served. One refresh token mints at most 10 access tokens per 10 minutes (`docs/decisions/fsm-trial.md`), and another proof was running against the same org at the same hour. Nothing in our code is wrong; the budget is shared, and two proofs at once can exhaust it. Recorded as open point 60.

### What staging still cannot prove

- **The chat itself.** The landing renders and its Open Graph tags are right, but how WhatsApp draws the invite on an Android and an iOS handset (boards B1 and B2) can only be seen on a handset. The card is composed by hand here; composing it in the browser from the client's own visit photographs is the app's, and was not exercised.
- **The message on a handset.** Only allowlisted numbers receive anything, delivery receipts are not set up on the shared Evolution instance (open point 18), and the texts are placeholder (open point 19).
- **The house card is a placeholder:** two tones and the gold rule, no photograph (open point 43).
- **Every pincode is served** on staging (open point 21), so "not served" had to be arranged by hand and the real service area is not proven.
- **With self-serve booking off**, the landing would answer `409 ops_assisted`. That is production's setting and it is still open (open point 41).
- **The other three fraud rules** are covered by tests only. `shared_upi` could be shown on staging by paying both visits from the same test UPI handle.
- **A first fit closed in FSM.** The grant was settled from appointments written into D1, so the leg from FSM's Completed through the mirror to `visits.outcome = 'done'` is P2-M2's to prove, not this one's.

## P2-M5: self-serve booking and money

The price book, availability, holds, Razorpay Checkout, credit redemption, moving and cancelling under the 24-hour rule, refunds and late fees, all behind `SELF_SERVE_BOOKING` (ADRs 0045, 0046 and 0033). The code is checked in `test/worker/client-booking.test.ts`, `bookings.test.ts`, `visit-changes.test.ts`, `credit-bookings.test.ts` and `test/node/policy-moving-a-visit.test.ts`, and the app's own flow in `e2e/app/booking.e2e.ts` and `e2e/app/changes.e2e.ts` against a faked Checkout.

### The checks the prompt asks for

From `docs/prompts/phase2-backend.md`, P2-M5, whose staging proof "covers each consequence in design screens C4 to C8":

> - payment failed
> - hold expired
> - a move outside 24 hours carries the payment over
> - a cancel inside 24 hours loses the credit
> - a first-fit move inside 24 hours charges the late fee and carries the balance

### How each is proven

All five are run in the client app at 390 px on `https://app-staging.maneman.in`, signed in from the allowlisted handset, against Razorpay's **test** keys: no real money moves. Razorpay's dashboard lists the test instruments that succeed and the ones that fail on purpose; a failing one is used for the first check.

A visit that starts within 24 hours cannot be booked through the app, since availability offers 14 days from tomorrow. For the two "inside 24 hours" checks, ops schedule the visit in FSM for later today or early tomorrow, and the mirror brings it back.

- [ ] **Payment failed (C6).** **Not yet run.** Visits → Book your next visit → date, window, then pay with an instrument that fails. Checkout reports the failure, the page shows C6's failed state with the hold still counting, and paying again with a good instrument books the visit. `SELECT state FROM payments ORDER BY created_at DESC LIMIT 2;` holds the failure and then the capture; a failed attempt is not a payment and never appears in `GET /api/payments`.
- [ ] **Hold expired (C6).** **Not yet run.** Take a hold and leave it: the countdown runs from 10:00, and at zero `GET /api/holds/{id}` says it has lapsed and the page offers the windows again. `SELECT expires_at, booked_at, refunded_at FROM slot_holds ORDER BY created_at DESC LIMIT 1;` shows it unbooked. A capture that arrives after the hold has lapsed is refunded in full, and the refund is claimed on the hold, so a repeated message cannot refund twice (ADR 0045).
- [ ] **A move outside 24 hours carries the payment over (C7).** **Not yet run.** Home → Reschedule, on a visit more than 24 hours off. `POST /api/appointments/{id}/reschedule` with `{}` answers the terms first: the notice, `free_until`, what the payment holds, and a cost of `free`. Pick a new date and window; the hold is priced at nothing and the move goes through in place. Afterwards the FSM appointment keeps its ID with new times, the mirror's `window_start` has moved, the payment is still the visit's, and `SELECT kind, notice, refunded_paise, kept_paise FROM visit_changes ORDER BY created_at DESC LIMIT 1;` records the move. A `reschedule_confirmation` is queued (ADR 0047), and reaches the handset if the client has switched WhatsApp about visits on.
- [ ] **A cancel inside 24 hours loses the credit (C8).** **Not yet run.** First the client needs a credit: from P2-M3's grant, or from `scripts/import-referrals.ts` on staging. Book a service visit with it: the hold says `credit: { remaining }`, payment is skipped, and one `redeem` of −1 is written against the grant that expires soonest. Ops then move that visit inside 24 hours in FSM. `POST /api/appointments/{id}/cancel` with `{"confirm":false}` answers the terms, which say the credit is lost; `{"confirm":true,"notice":"late"}` cancels it. A correct result is no `restore` row in `credit_ledger`, a balance one lower, and `visit_changes` recording the cancel at late notice. Cancelling the same visit more than 24 hours out writes the `restore` instead, to the grant it came from, and that pairing is what makes the check mean anything.
- [ ] **A first-fit move inside 24 hours charges the late fee and carries the balance (C7).** **Not yet run.** Book and pay for a first fit, then have ops move it in FSM to within 24 hours. `POST /api/appointments/{id}/reschedule` with `{}` answers a cost of `late_fee` and the amount, the price book's `late_fee_first_fit` (Rs. 4,000 on staging, the design's figure). Pay it through Checkout: the visit keeps its technician and its FSM appointment ID, the original payment carries over, and the late fee is a second payment, of purpose `late_fee`, on the same visit. `GET /api/payments` then shows both, each saying what it paid for.
  - If the terms change between the answer and the confirmation, because the 24 hours ran out, the route answers `409 terms_changed` and the app shows the new terms. That is worth showing in the same sitting.

### Also to be proven with this milestone

- [ ] **A refund reaches its source and is recorded in Books.** **Not yet run.** Cancel a paid visit more than 24 hours out: Razorpay refunds to source, the webhook writes the refund, `GET /api/payments` shows it with its destination, and the five-minute pass records it in Books from `BOOKS_REFUND_ACCOUNT_ID` (open point 39, set on staging on 22 September 2026).
- [ ] **With `SELF_SERVE_BOOKING` off, booking, reschedule and cancel answer `409 ops_assisted`,** and the app opens WhatsApp to ops with the visit named. **Not yet run.** As with Phase 1's ceiling drill, this needs a staging version deployed with the flag off, and staging then put back on the pipeline's version.

### What staging cannot prove yet

- **No real money.** Test keys only; KYC, live keys and a live webhook wait for production (open points 5 and 6).
- **The figures are the design's.** Prices, the late fees, the late-cancel refund and the change copy are placeholders, or our reading of the rule, and the owner has still to confirm them (open points 1 and 7). The design does not draw the way from C7 to C8 either.
- **GST is 0%.** The app shows the ex-GST figure as the main number with the inclusive figure beside it; with GST off the two are equal, so the proof shows the plumbing, not the arithmetic (open points 2 and 3).
- **No refund voucher.** Books gives no PDF for a refund that we have found, so the entry carries its destination and a **Notify me** that asks ops on WhatsApp (open point 35).
- **Self-serve is on in staging and off in production** (open point 8), so what production will do is only ever shown by turning the flag off deliberately.
- **A move to another technician** is dispatch's, in P2-M4, and there is one technician on staging in any case (open point 12).

## P2-M6: DPDP readiness

Erasure reaching Phase 2's data and the FSM contact, the client's own export, grievances, the retention jobs and a breach runbook (ADR 0049, on top of ADR 0019's erasure). The code is checked in `test/worker/dpdp.test.ts` and `erasure.test.ts`.

### The check the prompt asks for

From `docs/prompts/phase2-backend.md`, P2-M6:

> **P2-M6 — DPDP readiness** (roadmap Stage 4, before 14 May 2027): access and deletion requests end to end, retention jobs verified, and a breach runbook.

### Staging proof, 23 September 2026

Run in the same sitting as P2-M3 above, on the same staging version, with the same test people: "Staging test" with random `9xxxxxxxxx` numbers, each given a client session written into `sessions` by hand because a login code would have to reach a handset. **The person erased below is one this proof created this morning**, checked against their own `people.id` before the call; nothing else was erased and production was not touched.

- [x] **An access request, end to end.** `GET /api/me/export` answered 200 with `Content-Disposition: attachment; filename="maneman-my-data.json"` and `Cache-Control: private, no-store`. The file holds `exported_at` and then `person`, `addresses`, `consents`, `visits`, `payments`, `refunds`, `credits`, `referral`, `messages`, `grievances` and `try_ons` — the whole list the record asked for. A friend's file was 818 bytes and the referrer's 1,487. Consents carry their notice version (`referral-consultation-v1`); credits carry the kind, the visits and the expiry; **messages carry the kind, the state and the date and nothing else**. Nobody else's data appears, apart from the technician's display name on a visit, which the app shows that client anyway. `SELECT action, actor_kind FROM audit_log WHERE action = 'data.export';` records each one under the client, `actor_kind` `client`.
- [x] **A grievance, end to end.** `POST /api/grievances` answered 201 with the ID and `open`. `GET /api/grievances` on `ops-staging.maneman.in` listed it with the client's name, number, words and date. `POST /api/grievances/{id}/resolve` answered `{"state":"resolved"}` and the list emptied. `audit_log` holds `grievance.raise` under the client and `grievance.resolve` under the member of staff. The route's alert names the grievance's ID and nothing else (`src/routes/client-data.ts`), but it goes to the alert webhook, so **the owner is to confirm the message reached the Google Chat space**.
  - **The console has no Grievances screen.** The alert's own words are "answer it in the ops console", and the console has Dispatch, Clients, No-shows, Referrals, Waitlist, Tasks and Technicians and nothing else. Both grievance routes are API-only today. Recorded as open point 61.
- [x] **A deletion request, end to end.**
  1. The client asked in the app: `POST /api/deletion-request` answered `202 {"state":"requested"}`. Asking a second time answered 202 again and left **one** row in `deletion_requests`. `audit_log` holds `deletion.request` under the client.
  2. `GET /api/deletion-requests` on the ops surface listed it. `POST /api/deletion-requests/{id}/decision` with `{"decision":"delete"}` alone was refused `400 invalid_request`, field `reason`: the body must carry `reason`, even as `null`, though the route's own description says a reason is needed to reject. With the reason it answered `{"state":"done"}` in 1.53 s. `deletion.decide` is audited **before** the erasure runs, which is right: an erasure cannot be undone.
  3. What the erasure did, at **08:12:59.232**, checked as the runbook's "Erasure within the day" sets out:
     - the person is `name` "Erased", `mobile_e164` replaced by `erased:<their id>`, `contactable` 0, `erased_at` set;
     - their one saved address is gone;
     - all three visit photographs are gone: the rows from `photos`, and the three objects from `mm-staging-client-photos`, which no longer download (a live object of the same size downloads and says so; these return nothing);
     - their live session is revoked, and the app refused the next request;
     - the open grievance's words are replaced with "Erased", and the grievance itself is kept for ops;
     - the credit grant and the visit are kept, as records.
     - **Left behind:** the two `photo_sets` rows survive with no photographs in them. They hold an appointment ID and the word "before" or "after", so no personal data, but they are a loose end. Recorded as open point 62.
  4. `SELECT erased_at, crm_erased_at, fsm_erased_at, fsm_erasure_attempts FROM people WHERE id = '<person_id>';` filled all three: `crm_erased_at` 08:15:54.119 on the first attempt, `fsm_erased_at` 08:15:54.969, both **2 min 55 s** after the erasure. Not seconds, as Phase 1's was: the ops route does not queue the CRM and FSM work itself, as `POST /api/erasure` does; the five-minute sweeper picks up anyone erased more than two minutes ago. It is within the runbook's "a few minutes", but it is slower than the other door. Recorded as open point 63.
  5. The Worker's logs over the whole sitting hold neither number, in either form, nor any name; the lines carry IDs and counts.
  - **In Zoho.** The blanking of the CRM record and the anonymising of the FSM contact are recorded as done by our side on the first attempt. What the two records now look like in the org, and whether their timelines still hold the old values, is the owner's to confirm (ADR 0019, open for legal).
- [x] **The retention jobs.** Nothing waits 7 days or 365 in a proof, so each was shown by arranging a row and letting the real five-minute cron find it.
  - **The 7-day window.** A deletion request was back-dated to 18 September. The 08:15:48 pass alerted once and set `alerted_at` to 08:15:51.053. The next pass left it alone: `alertAgedDeletions` only matches `alerted_at IS NULL`, so it cannot alert twice.
  - **Credit expiry.** A grant of 2 visits was written for a test client, expiring at 08:16:00. Before that, `GET /api/me` read `{"visits": 2, "earliest_expiry": "2026-09-23T08:16:00.000Z"}`. The 08:20:48 pass logged `referrals_settled … credits_expired: 1` at 08:20:50.961 and wrote one `expire` entry of **−2** against that grant at 08:20:49.975; `GET /api/me` then carried no credit tile at all (`credits: null`). The 08:25:48 pass wrote nothing and logged no `referrals_settled` line at all: `credit_ledger` still holds exactly one `expire` row.
  - **The clawback.** A granted first fit was marked refunded in full (`payments.status = 'refunded'`, kind `visit`). The 08:15:48 pass logged `referrals_settled … clawed_back: 1` at 08:15:53.334 and wrote a `clawback` of **−3** against each side's grant at 08:15:51.868; the attribution is `clawed_back`; and the referrer's balance fell from 6 to 3, leaving only the grant ops had approved. The friend they had referred dropped out of their tracker with it.
  - **Try-on retention.** Two jobs were arranged with their own synthetic images, so no one else's try-on was touched. A `ready` job whose `expires_at` was 30 days past became `expired` and its result was deleted from `mm-staging-tryon-results`; its upload was deleted from `mm-staging-tryon-uploads` and `upload_deleted_at` set to 08:15:45.153, an hour after the job. A job left `awaiting_upload` for three hours became `expired` too.
- [ ] **The breach runbook.** **Walked through as far as staging allows.** The scenario was a leaked Worker secret.
  - **What was checked.** `wrangler secret list --env staging` names the 21 secrets that `W secret put … --env staging` would rotate, `ALERT_WEBHOOK_URL`, `ERASURE_SECRET`, `EVOLUTION_API_KEY`, `OTP_PEPPER`, `RAZORPAY_KEY_SECRET`, `RESULT_SIGNING_KEY`, `ZOHO_*` and the rest among them, so step 1's first command has a real target and the list is the right one to work down. `UPDATE sessions SET revoked_at = …` was run against this proof's own three sessions, which is step 1's last command, and the next request with one of those cookies was refused `401 session_required`.
  - **What was not run, and why.** Rotating a live secret, revoking a Zoho, Razorpay or Evolution key in its console, signing an ops user out of Cloudflare Access, turning a surface off in `wrangler.jsonc` and rolling a Worker version back all change staging for everyone using it, and two other proofs were running the same morning. Each is the owner's to rehearse in a quiet hour. What would prove them: one sitting with staging to itself, rotating `RESULT_SIGNING_KEY` and putting it back, and rolling `mm-api` to the previous version and forward again with `scripts/release.ts`.
  - **The notices are addressed to nobody.** No Grievance Officer is named and the runbook's contacts are missing (open point 42), so steps 4 and 5 can be read but not rehearsed.

### What staging still cannot prove

- **Nobody to notify.** No Grievance Officer is named, the 30-day answer time in the app is a placeholder, and the breach runbook's contacts are missing (open point 42). The notification steps can be rehearsed, but they are addressed to no one.
- **The app's copy is a placeholder.** The design draws no "Your data" card, so its words are ours until the owner approves them (ADR 0049, open point 20).
- **Deletion in FSM is anonymisation, not deletion.** The contact stays, with its name, numbers, e-mail and street cleared and its city kept (ADR 0049). Zoho's own timeline may still hold the old values, as the CRM's may; that is open for legal (ADR 0019).
- **The 8-year invoice retention** cannot be shown, only stated: nothing deletes an invoice, and Books holds them.
- **Deletion within 7 days in production** is not proven by a staging run. Production holds its FSM, Books and payments providers at `none` until Phase 2's release, so an erasure there reaches fewer places today than it will.
- **Ops have no screen** for grievances, deletion requests or number changes, so every DPDP action ops take was an API call here, and how a member of staff would find and answer one is not proven (open point 61).
