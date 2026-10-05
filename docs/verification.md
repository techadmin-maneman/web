# Verification

What each milestone's definition of done required, how it was checked, and the result.

## M1: skeleton, environments, pipeline

Checked on 21 September 2026 on Windows 11, Node 24.18 and wrangler 4.135.0, against the live Cloudflare account, and in GitHub Actions on PR #1.

My network's DNS resolver still cached GoDaddy's old addresses for `maneman.in` that day. The remote smoke runs therefore sent `*.maneman.in` to Cloudflare's edge (`104.21.84.97`) with a scratch Node preload, not through the local resolver. Public resolvers (Cloudflare and Google DNS-over-HTTPS) already returned Cloudflare's addresses.

| Requirement                                                                         | Evidence                                                                                                                                                                                                                                                                                                                                                                          | Result                                                                                              |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Both Workers deploy to staging and production with placeholder responses            | Bootstrapped with `wrangler deploy`, then redeployed at commit `ba357b1` through `scripts/release/release.ts`. Full smoke suite passes in both environments: health, error shape, mm-site routing, indexing                                                                                                                                                                       | **pass**                                                                                            |
| `/api/health` reports the right environment in each                                 | production `{"environment":"production","d1":"ok","version_tag":"ba357b1…"}`; staging `{"environment":"staging","d1":"ok",…}`                                                                                                                                                                                                                                                     | **pass**                                                                                            |
| Worker refuses to start without a valid `ENVIRONMENT`, or as production with a stub | Tests in `test/worker/platform/guard.test.ts`. `wrangler dev --var ENVIRONMENT:production` fails to start (also asserted in CI). **Remote:** `wrangler versions upload --env staging --var ENVIRONMENT:production --var IMAGE_PROVIDER:stub` rejected by Cloudflare: `Uncaught Error: ConfigError: mm-api refuses to start: IMAGE_PROVIDER is a stub in production [code: 10021]` | **pass**                                                                                            |
| Worker refuses to serve on another environment's database                           | Tests for unmarked, mismatch and unreachable (503). Identity row immutable. `maneman-staging` and `maneman-prod` marked and read back                                                                                                                                                                                                                                             | **pass**                                                                                            |
| Migrations apply in CI                                                              | On every PR, all applied to an empty D1 and none left pending: a `migrations apply` job at M1, and the `smoke (local)` job's "Nothing is left unapplied" since (`ci.yml`). Remote staging and production: applied with the same command the workflows run                                                                                                                         | **pass** locally and remotely. From the deploy workflows: waits on the CI tokens (runbook step 6)   |
| Every PR check runs                                                                 | `ci.yml`: typecheck, lint, format, test, config check, migrations apply, dependency audit, build, smoke (local); all green on PR #1                                                                                                                                                                                                                                               | **pass**                                                                                            |
| Every PR check is required on `main`                                                | Branch protection is refused on this plan                                                                                                                                                                                                                                                                                                                                         | **deferred** by the owner to the paid GitHub plan (0008)                                            |
| The binding-redeclaration check fails a deliberately broken config                  | CI requires `test/fixtures/wrangler/broken-staging-inherits-bindings.jsonc` (the real config with staging's queues removed) to fail with `env.staging: queues.producers is not redeclared`. Rule-by-rule tests in `test/node/tooling/wrangler-config-check.test.ts`                                                                                                               | **pass**                                                                                            |
| Production workflow demands approval                                                | Runs in the `production` GitHub Environment; required reviewers are refused on this plan                                                                                                                                                                                                                                                                                          | **deferred** (0008). The workflow is manual and accepts only a commit on `main` that passed staging |
| Gradual deployment with automatic rollback on failed smoke                          | Rehearsed against production with the workflow's own commands, listed below                                                                                                                                                                                                                                                                                                       | **pass**. The workflow itself runs once the CI tokens exist                                         |
| Structured logs with redaction                                                      | `test/worker/platform/log.test.ts`. Access logs record the route pattern, never the path                                                                                                                                                                                                                                                                                          | **pass**                                                                                            |
| Coverage ≥ 85% lines on `src/`                                                      | `npm run test:coverage`                                                                                                                                                                                                                                                                                                                                                           | **pass**: 99.4%                                                                                     |

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

Checked with `scripts/release/verify-ci-token.ts` from GitHub Actions (run 35596608538), using the secrets as stored in the GitHub environments. All checks pass in both environments:

- Each Cloudflare token is account-owned and reaches its own two Workers and its own database. It is denied the other environment's Workers, the zone's routes, R2 and Queues. It can read and write the other environment's database, since D1 Edit is account-wide, as accepted in ADR 0008. (The check read it only until 25 September 2026; it now also reports the write, with an update that matches no row.)
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

### A rollback by hand, rehearsed on staging, 2 October 2026

The runbook's "Rolling back a Worker version" on `mm-site-staging`, between two staging deploys, with wrangler 4.135.0:

1. `release.ts current --worker mm-site --env staging`: `d1362126…` (commit `17de1fe9`). The version before it, `2f14a7ae…`, built the same pages, so the rehearsal went back to `c7ff524c…` (commit `da6d74ce`), whose `/book` differs. That shows what the edge serves changed, not only Cloudflare's record.
2. `release.ts restore --env staging --message "rollback rehearsal (P0-20)" --to mm-site=c7ff524c…` at 14:26:59 UTC: "restored" 14 s later. `release.ts current` answered `c7ff524c…`, `/book` named the older build's `Invite.Cp272hs4.css`, and the smoke suite passed.
3. Before rolling forward, `release.ts current` still answered `c7ff524c…`, so no deploy had moved it on. `restore --to mm-site=d1362126…` at 14:27:48: "restored" 14 s later, `/book` named `Invite.u_Eeh9hu.css` again, and the smoke suite passed.
4. The same restore once more: "unchanged".

`wrangler deployments list` records both, with their messages. What a release does when Cloudflare drops a reply (an upload that landed is not made twice; a split is checked before failing) needs Cloudflare to drop one, so it is proven against a fake account in `test/node/tooling/release.test.ts`, not live.

## M2: lead path

Merged in PR #3. Fixes from the staging proof: PR #4 (Zoho call timing, 20-second timeout, a quick retry) and PR #5 (the checker confirms `D1_Person_ID` is unique).

| Requirement                                      | Evidence                                                                                                                                                                                                                                                                                               | Result                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `GET /api/cities`                                | `test/worker/platform/entrypoints.test.ts`: active cities in display order, `Cache-Control: public, max-age=300`. Local `wrangler dev` answers with the seven seeded cities.                                                                                                                           | **pass**                                                            |
| Booking lead with proposed date and window label | `test/worker/lead.test.ts`: person, `contact` consent (`booking-v1`), pending lead, queued sync; weekday and weekend dates; blackouts; the India date boundary (`test/worker/visit-date.test.ts`). Local `wrangler dev`: Noida, weekend morning → `2026-09-26`, "before noon".                         | **pass**                                                            |
| Waitlist                                         | Mumbai → `served: false`, no date, source `waitlist`; opening a city is an `UPDATE`.                                                                                                                                                                                                                   | **pass**                                                            |
| Consents append-only, notices versioned verbatim | Triggers reject `UPDATE` and `DELETE` on `consents`. `test/worker/privacy/notices.test.ts` locks the three published texts by hash.                                                                                                                                                                    | **pass**                                                            |
| Idempotency                                      | A replay returns the first response without a second lead; a reused key with a different body gets 422; a key in progress gets 409; a failed request releases its key. Local `wrangler dev` replay confirmed.                                                                                          | **pass**                                                            |
| Rate limits                                      | 5 a day per mobile, 20 a day per IP (src/config/limits.ts). Counter keys are salted hashes.                                                                                                                                                                                                            | **pass**                                                            |
| Validation                                       | Unknown fields, bad names and mobiles, consent not given, unknown or inactive city, malformed JSON: all `400 invalid_request` with field names only.                                                                                                                                                   | **pass**                                                            |
| Turnstile                                        | Rejected → 403, unreachable → 503. Locally verified against Cloudflare's siteverify with the test keys. Staging and production widgets created; secrets set on both Workers.                                                                                                                           | **pass**                                                            |
| `crm-sync` against Zoho                          | Adapter tested against the v8 shapes (`test/worker/vendors/zoho.test.ts`): insert with `lar_id` and workflows, waitlist unassigned, try-on-only with `trigger: []`, update and note, search before insert, token cache, refresh on 401, errors without record data. Local queue → stub CRM end to end. | **pass**, on staging against the Zoho Developer Edition org (below) |
| A try-on-only lead is never chased               | `test/worker/vendors/crm-rules.test.ts`: for every source a non-contactable person gets delivery-only, no assignment and no workflows, and `assertStatusAllowed` throws on any other status.                                                                                                           | **pass**                                                            |
| Sweeper                                          | `test/worker/jobs/sweeper.test.ts`: pending leads older than 2 minutes and failed ones under 10 attempts re-enqueued; idempotency and counters purged. On staging the cron runs every five minutes and delivered both drill leads (below).                                                             | **pass**                                                            |
| No personal data in logs                         | Local run: the log contains neither the test name nor the number. Request IDs are carried through the queue into consumer logs.                                                                                                                                                                        | **pass**                                                            |
| Free tier                                        | Account confirmed on Workers Free; binding allowlist in the config check (ADR 0009).                                                                                                                                                                                                                   | **pass**                                                            |

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

- **Overlapping runs.** Queues ran two consumer invocations at once, despite `max_concurrency: 1`. Zoho refuses a second record with the same `D1_Person_ID`, so this cannot duplicate a record. It can add an extra update and note. `scripts/ops/check-zoho-setup.ts` now fails if the field allows duplicates.
- **Search lag.** Zoho's search didn't find a new record 25 seconds after it was created, but did by two minutes.
- **An unexplained stall.** One consumer run waited 8 min 40 s with no Zoho call, so the time went to its first D1 queries or to the platform; from inside the Worker the two look the same. It delayed one lead and lost nothing. If it recurs, it goes to Cloudflare support.
- **No duplicates.** Seven test people, seven Zoho records.

## M3: try-on and messaging

**Since 1 October 2026 the try-on's look goes to WhatsApp only** ([ADR 0104](decisions/0104-the-try-ons-look-on-whatsapp-only.md)): the gate's claim comes before the render and opens no session, `GET /api/tryon/result` is gone, and the claim no longer answers `whatsapp_copy`. The proofs below and under F3 are of the try-on as it was then; the new order is proven locally (`test/worker/site/tryon-api.test.ts`, `e2e/try-api.e2e.ts`), and `scripts/staging/staging-tryon.ts` runs it on staging with an allowlisted number.

Merged in PR #6. Fixes from the staging proof: PR #7 (a WhatsApp send that timed out is not retried), PR #8 (slow renders are followed for 15 minutes) and PR #9 (timing for stalled consumer runs). The code is also checked locally against the stub AILabTools, which the real adapter talks to over a fake HTTP API with the documented response shapes.

| Requirement                                                        | Evidence                                                                                                                                                                                                                                                                                                                                                                           | Result                       |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Reference material copied and read, with an ADR of every departure | `docs/reference/ailabtools-api-notes.md` and `data/ailabtools-catalog.json`, verbatim; `docs/reference/README.md`; `docs/decisions/0013-departures-from-the-ailabtools-harness.md` (14 departures)                                                                                                                                                                                 | **pass**                     |
| Upload with photo consent                                          | `test/worker/site/tryon-api.test.ts`: consent must be literally `true` with the photo notice's version; Turnstile; 5 an hour per address; the daily upload ceiling. Through the API, not a presigned link (`docs/decisions/0014-try-on-api.md`): one R2 write per job, JPEG or PNG by its bytes, at most 5 MB, 200 to 4090 px                                                      | **pass**                     |
| Generate with colour routing and deduplication                     | Detected colours sent as they are; `unknown` went to Premium with `original` at M3, and goes to Pro in black in every environment since ADR 0018 (`UNKNOWN_COLOR_ROUTE`, `src/config/tryon.ts`), the route recorded either way; an identical request returns the existing job; a different look needed the session at M3, and is refused since ADR 0018 (`403 look_limit_reached`) | **pass**                     |
| Render consumer: delayed-retry polling, download-only retry        | `test/worker/vendors/render.test.ts`: polls every 5 s, then 10 s, then once a minute; gave up at 180 s at M3, and at 15 minutes since PR #8 (`RENDER_GIVE_UP_MS`, `src/config/pipeline.ts`); submits once however often the message is delivered; a stalled download recovers from the stored URL with one submit; a URL that expires fails the job with an alert                  | **pass**                     |
| Premium's wrong-extension 502 is `photo_invalid_file`              | `test/worker/vendors/ailabtools.test.ts` and `render.test.ts`, through the stub's replay of the 502                                                                                                                                                                                                                                                                                | code **pass**; staging below |
| Status                                                             | `GET /api/tryon/status/:job_id`: state, and the failure code once failed                                                                                                                                                                                                                                                                                                           | **pass**                     |
| Claim before `ready`                                               | A gate while rendering saves the person (not contactable), both consents, a `tryon` lead with the stage as its loss extent, a session cookie and a waiting message, and queues the CRM sync; idempotent, 3 a day per number                                                                                                                                                        | **pass**                     |
| Session-scoped results and more looks                              | Results only for the owning session, or, since ADR 0024, the browser that had the look. The second look passed at M3 as a new job on the same photo, with no second gate or lead, logging `try_on_additional_look`; ADR 0018 withdrew it: one look per visitor, and the event is no longer written                                                                                 | **pass**                     |
| Spend ceiling                                                      | Global daily ceilings on uploads, renders and result reads; the render ceiling trips at 3 in `tryon-api.test.ts`; alerts once a day                                                                                                                                                                                                                                                | **pass**                     |
| Free tier                                                          | `test/node/tooling/free-tier-budget.test.ts`: the committed ceilings of both environments stay under 80% of every Queues and R2 allowance (`docs/decisions/0015-render-pipeline.md`)                                                                                                                                                                                               | **pass**                     |
| Credit monitor                                                     | `test/worker/jobs/sweeper.test.ts`: the hourly run sums the pools and alerts below the floor                                                                                                                                                                                                                                                                                       | **pass**                     |
| Messaging queue                                                    | `test/worker/messages/messaging.test.ts`: sends a one-hour signed link; skipped when messaging is off, the person is erased, the number is not on the allowlist, or three have gone today; retried three times, then failed with an alert. Through Evolution for now (`docs/decisions/0016-whatsapp-through-evolution.md`)                                                         | code **pass**; staging below |
| Try-on-only lead in Zoho as `Try-on — delivery only`, unassigned   | M2's rules (`test/worker/vendors/crm-rules.test.ts`); the claim writes the lead the sync reads                                                                                                                                                                                                                                                                                     | code **pass**; staging below |

### Staging proof, 21 September 2026

Run with `scripts/staging/staging-tryon.ts` through Cloudflare Access, and with `scripts/staging/ailabtools-probe.ts` directly against AILabTools with the staging key. Times are Cloudflare's (UTC).

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
  - The balance was 1,680 credits before and after. The real download-failure path (three quick tries, then the sweeper) is covered by `test/worker/vendors/render.test.ts`.
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

| Requirement                         | Evidence                                                                                                                                                                                                                                                                                                                                                                                  | Result                       |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Erasure                             | `test/worker/privacy/erasure.test.ts`: photos and results deleted from R2; the person blanked, their number replaced; sessions ended; jobs expired; one withdrawal consent per purpose; a `person_erased` event; the CRM update queued. A wrong or missing secret gets 401, an unknown or erased number 404. The number can book again as a new person (`docs/decisions/0019-erasure.md`) | code **pass**; staging below |
| Unsent messages cancelled           | The same test: `waiting` and `queued` messages become `skipped`, and a `sent` one is left alone. The messaging consumer also skips anyone erased (`test/worker/messages/messaging.test.ts`)                                                                                                                                                                                               | **pass**                     |
| The CRM record blanked              | `test/worker/vendors/zoho.test.ts`: the record found by its stored ID or by `D1_Person_ID`, updated with workflows off, and noted. `test/worker/vendors/crm-sync.test.ts`: once however often the message comes; a scrubbed error; a quick retry, then the sweeper, then an alert; an erased person's lead is never sent                                                                  | code **pass**; staging below |
| A render finishing after an erasure | `test/worker/vendors/render.test.ts`: the result is deleted when the job was erased during its download, and kept when a parallel run stored it. `erasure.test.ts`: a result stored between erasure's read and its batch is deleted                                                                                                                                                       | **pass**                     |
| Redaction test                      | `test/worker/platform/log.test.ts`: names, numbers, e-mails, images and credentials redacted by field name at any depth, and numbers scrubbed from free text. Route and consumer tests check their log lines hold no name or number, erasure included                                                                                                                                     | **pass**                     |
| Coverage gate                       | `vitest.config.ts` fails the run below 90% of lines or 80% of branches in `src/`, and the vendor clients have floors of their own (since 26 September 2026; 85% of lines before); CI runs it on every pull request. After the erasure proof: 383 tests, 97.4% of lines                                                                                                                    | **pass**                     |
| 50 concurrent lead submissions      | `scripts/staging/load-test-leads.ts` on staging (below)                                                                                                                                                                                                                                                                                                                                   | **pass**                     |
| `docs/api.md` generated             | `npm run openapi` writes `docs/openapi.json` and `docs/api.md` from the zod schemas; `test/worker/platform/contract.test.ts` fails if either is out of date                                                                                                                                                                                                                               | **pass**                     |
| Runbook                             | `docs/runbook.md`: provisioning, secrets, free tier, replaying leads and messages, D1 point-in-time restore, erasure within the day, cities and blackout dates, rolling back a Worker version                                                                                                                                                                                             | **pass**                     |
| One production release              | `deploy-production` released `268eaa4` on 21 September 2026 (below)                                                                                                                                                                                                                                                                                                                       | **pass**                     |

### Load test, 21 September 2026

`scripts/staging/load-test-leads.ts` sent 50 requests at once to staging at 16:43:53 UTC: 25 test people, each booked twice with the same `Idempotency-Key`, as a double-tapped submit would be. Staging's limit of 20 leads a day per address is below 50, so the test ran on a staging version with that limit raised to 200. Staging then went back to the pipeline's version.

- All 50 answered within 2.1 s (median 1.6 s). 25 got 201, and their 25 twins got 409 `idempotency_in_progress`.
- One lead ID per person: no duplicates in D1.
- 25 records in Zoho, one per person, all synced about 70 s after the burst. None failed.

### Erasure on staging, 21 September 2026

Run through Cloudflare Access with `scripts/staging/staging-tryon.ts` and `scripts/erase-person.ts`, against a fresh random test number that isn't on the messaging allowlist. Times are the Worker's (UTC).

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

Production had run the M1 skeleton until now. Its secrets were set first. Zoho is staging's test org for now, at the owner's request (docs/decisions/0020-production-on-the-zoho-test-org.md). `scripts/ops/check-zoho-setup.ts` passed with production's values.

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

PR #15 put the static port of Mane Man Site v2 on `https://staging.maneman.in`. Each section and state was checked against the design at 390 and 1440 px, pair by pair (`docs/fidelity/`), and each item in `docs/archive/feature-inventory.md` names its evidence.

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

It was written before the event. **All four have since been run**, on 23 September 2026, and the four sections below are records of what was seen, ticked where it was observed and left unticked with the reason where it was not. Where a check still says **not yet run**, that is what a correct result would look like, not what was seen.

| Milestone | What it covers                                                                                                                                                  | Merged in                                                   |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| P2-M2     | The FSM and Books connection, the mirror, the reconciliation, visit photographs, the payments mirror, Books receipts, and booked leads into FSM                 | PRs #41 to #46, #49 and #54; the app's read surfaces in #48 |
| P2-M3     | Pincodes, referral codes, the landing's APIs, the waitlist, the credit ledger, the grant, fraud holds, ops' review, the cards, the preview image and the import | PR #62                                                      |
| P2-M5     | The price book, availability, holds, Razorpay Checkout, credit redemption, moving and cancelling under the 24-hour rule, refunds and late fees                  | PRs #50, #51 and #55, with #63; the app's booking in #52    |
| P2-M6     | Erasure reaching Phase 2's data and FSM, the client's own export, grievances, the retention jobs and the breach runbook                                         | PR #62                                                      |

### How every proof below is run

- **Access.** Every staging host is behind Cloudflare Access (runbook, step 11). A script gets through with the `mm-ci-staging` service token in `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`; a person gets through with the founders' login. Only `/api/hooks/` and `/api/result/` bypass it, and each checks its own secret (runbook, steps 10 and 12). (Corrected 27 September 2026: WhatsApp's crawler has no login either, so it met the sign-in, and every invite shared from staging reached WhatsApp with no image. The landing and its card need `r/`, `images/` and `api/og/` to bypass Access as well; they check no secret, and serve what production serves anyone with the link. The owner is to add that bypass (runbook, step 10b), and `npm run smoke -- --base https://staging.maneman.in --environment staging --link-preview <code>` says whether the crawler gets through.)
- **The hosts** are `https://staging.maneman.in` (public), `https://app-staging.maneman.in` (client), `https://ops-staging.maneman.in` (ops) and `https://tech-staging.maneman.in` (technician), all four surfaces switched on since 22 September 2026 (`src/config/environments.ts`). `npm run smoke -- --environment staging --surfaces` says whether each host answers before anything else is tried; on 23 September 2026 all three checked hosts passed on version `f6d314a9`.
- **A handset on the allowlist.** A client signs in with a six-digit code on WhatsApp; SMS is off (`SMS_PROVIDER` is `none`, open point 37) and staging sends only to its allowlist. So every proof that needs a login, or a message, needs a test handset whose number is on that allowlist.
- **Ops' screens.** The ops console is on `ops-staging.maneman.in` since P2-F4 — the `mm-ops` Worker, which the page names in its `mm-worker` meta tag — with Dispatch, Clients, No-shows, Referrals, Waitlist, Tasks and Technicians. Where a check is about an ops action one of those covers, it is done on the screen; everything else — grievances, deletion requests, number changes — is an HTTP request to the same host through Access. A script reaches either with the `mm-ci-staging` service token, so an action it takes is audited under that token's name, not a founder's. There was no Payments section, because no route totalled a day's money (open point 60), and no ops route creates a visit: scheduling is FSM's, and assigning and moving are the Dispatch board's. **Since then** (27 September 2026): the console has Grievances, Deletion requests and Number changes (#97, ADR 0078), and No-shows carries the day's money from `GET /api/payments` (#100), so the proofs below that call those routes by hand would now be run on the screens.
- **SQL** is `W d1 execute maneman-staging --env staging --remote --command "<sql>"`, as the runbook's preamble sets out. **The logs** are Workers Logs on the `mm-api` Worker.
- **No personal data.** As in Phase 1, each test person is "Staging test" with a random `9xxxxxxxxx` number, except the one allowlisted handset a message must reach. No real person's name, number or photograph goes into this record or into a test.
- **Staging's placeholders** (`docs/open-points.md`) are the ground every proof stands on: the price book holds the design's figures (open point 1) at 0% GST (open points 2 and 3), every NCR pincode is served from 22 September 2026 (open point 48), message texts are placeholder (open points 39 and 40), the house referral card is a placeholder (open point 52), and the CRM, FSM and Books are all in the owner's real org with staging's records labelled "Staging test" (open points 19 and 121).

## P2-M2: the mirror and the read surfaces

The FSM and Books providers, the mirror kept by webhook hints and a queue, the reconciliation, a visit's photographs into `mm-staging-client-photos`, the payments mirror from Razorpay's signed webhook, Books' receipts, and a booked lead reaching FSM as a Request (ADRs 0032 and 0044). The code is checked in `test/worker/fsm-mirror.test.ts`, `reconcile-fsm.test.ts`, `visit-photos.test.ts`, `client-visits.test.ts`, `razorpay-hook.test.ts`, `client-payments.test.ts`, `books-sync.test.ts` and `fsm-leads.test.ts`, against the stub FSM and the recorded Zoho shapes.

### The checks the prompt asks for

From `docs/prompts/phase2-backend.md`, P2-M2:

> - a staff-run job in the FSM trial org appears in `/visits` with its five-angle before-and-after set
> - the invoice PDF opens
> - a deliberately broken webhook is repaired by the nightly reconciliation

The prompt says "the FSM trial org". Staging's org is the owner's real one, with its records marked as tests (ADR 0025, item 26; open point 19).

### The staging proof, 23 September 2026

Run against `https://staging.maneman.in`, `https://app-staging.maneman.in` and `https://ops-staging.maneman.in` through Access, with the FSM and Books credentials the Worker itself uses, and Razorpay in test mode. Times are the Worker's and FSM's, in UTC. Every test person is "Staging test" with a random `9xxxxxxxxx` number; every FSM record made for the proof begins "Staging test:".

Three arrangements were made by hand, and each is named where it bears on a result:

- **No one signed in.** Staging sends WhatsApp only to its allowlist, and a test number is not on it, so the login code was never delivered and could not be read (it is kept peppered). The client sessions were written straight into `sessions`, which is the SHA-256 of the cookie's token (`src/domain/sessions.ts`). **The login itself is not proven here**; it needs the owner's handset.
- **A completed consultation** was written into `appointments` for the first-fit client, so that `bookableTypes` would offer a first fit, rather than running a second job in FSM for it.
- **Three credits** were granted with a `credit_ledger` row of kind `grant`, source `ops`, as ops would.

Two other proof runs were working against the same staging database and the same Zoho org that morning, so rows and records other than the ones named below are theirs, not this proof's.

### How each was proven

- [x] **A staff-run job appears in `/visits` with its five-angle before-and-after set.**
  1. **The lead.** `scripts/staging/staging-lead.ts` booked Gurgaon, weekday morning, at **07:47:10.409**. Lead `0a5ef320-0413-4525-9fad-7de71a9c31f0`, proposed date 2026-09-25, window "before noon". `leads.fsm_request_id` held `8229000000304279` by **07:47:19.687** — 9.3 s. FSM's Request REQ4 has the summary "Staging test: Consultation for Staging test", `Preference_Note` "Morning, 9 am to 12 pm", `Preferred_Date_1` and `Due_Date` 2026-09-25, and the contact `8229000000305231` the sync created.
  2. **Scheduling it in FSM did not go the way the prompt describes.** The Request's blueprint transition **"Convert to Work Order" answered SUCCESS and created no work order**: the Request moved to "Work In Progress", its `Work_Orders` stayed empty, and the org held the same single work order before and after. ~~FSM's own screen opens a form there, which the API does not.~~ **The second half was wrong, and "Converting a Request, taken up again" below corrects it: the API can convert a Request; the blueprint transition is simply not what does it.** So the job was made the way our own booking makes one: work order `8229000000305234` (WO13) of type Service on the Service visit item with the contact's addresses, and appointment `8229000000304285` (AP-14) on its service line, assigned to the one technician, 14:00 to 15:30 India time.
  3. **The hint arrived and the mirror wrote the copy.** `webhook_inbox` row `fcb09d2c-65e3-4ffd-ae0b-63c6f0d09852` at **07:52:31.574**, 0.6 s after the appointment was created; the copy `ab7b388c-c8d1-4525-af6a-010c30e3f944` was written at **07:52:45.144**, matched to the person by mobile number, type `service`, status `scheduled`, technician and city as FSM has them. Four hints were taken for this appointment over the run — one for the create, three for Dispatch, Start Work and Complete Work — each once, none with an error. The first was processed in 15.8 s and the second in 7.1 s; the last two took 46.2 s and 40.5 s, because the photographs were copied in them.
  4. **The job was run in FSM**: ten photographs attached, then Dispatch, Start Work and Complete Work, and the work order Completed and Closed. The photographs are 240 × 160 PNGs made for the test — flat colour, no person in them — named `before-front.png` through `after-hair.png`.
     - **The first ten attempts failed.** FSM answered `400 INVALID_DATA`, `"required field not found"` for `File_Id`. The upload to `/fsm/v1/files` answers `{ data: { file_id } }`, but the Attachments module takes **`File_Id`**, and `src/providers/fsm-zoho.ts` sent `file_id`. Sent as `File_Id`, all ten attached. **Fixed**, with `test/worker/fsm.test.ts` › "attaches an uploaded file by File_Id" to hold it. Nothing else uses that call yet: the mirror only reads attachments, and the technician app's own upload (P2-M4) is what would have hit it.
  5. **The mirror copied them.** The appointment became `completed` at **08:01:53.127**, with a `visits` row of outcome `done`; the export finished by **08:02:29.571**. `SELECT ps.phase, COUNT(*) …` gives `before 5` and `after 5`, stored under `visits/ab7b388c-…/` in `mm-staging-client-photos`.
  6. **Read as the client.** `GET /api/visits/{id}` returns both sets with the angles in the order front, top, left, right, hair. A photograph's link `/api/photos/file/<token>` answers **200 `image/png`** to the owning session, **401 `session_required`** without one, and **404 `not_found`** to the other test client's session, which also gets 404 on the visit itself. The token issued at 08:02:54 expired at 08:17:54: fifteen minutes.
  - Two fields are empty, and neither is a fault: `duration_minutes` is 0 because the job was started and closed seven seconds apart, and `what_was_done` is null because the job-sheet template is a placeholder (open point 28).
- [ ] **The invoice PDF opens.** **Not proven in the morning run, for two reasons. Both were ours, and both were answered that evening — see "The invoice, taken up again" below. What is still not proven is the app's own door onto it.**
  - The closed work order carried `Grand_Total` and `Sub_Total` of 2000 rupees and `Billing_Status` "Not yet Invoiced" — the price book's service-visit figure, with no tax, as open points 1 to 3 say it will be.
  - **First, the API would not raise it.** `POST /fsm/v1/Invoices` answers **`500 INTERNAL_ERROR`** with no detail, both for a body naming the work order alone and for one naming the contact, both addresses, the date and the service line. `/fsm/v1/Work_Orders/{id}/actions/create_invoice` is `404 INVALID_URL_PATTERN`; `/fsm/v1/Work_Orders/{id}/Invoices` is `400 INVALID_MODULE`. The work order's blueprint offers Complete, Cancel and Terminate, then Close, and no invoice step. `GET /fsm/v1/Invoices` answered 204: the module was there and empty.
    - **A likely reason, for whoever takes the API on.** Both attempts used the field names a work order takes — `Contact`, `Invoice_Date`, `Summary`, `Service_Address`, `Service_Line_Items`. The invoice FSM itself made carries none of those. Its fields are `Work_Order`, **`Contact_Id`**, **`Date`**, `Due_Date`, `Currency`, `Exchange_Rate`, `Grouped_Invoice`, `Status`, and `ZBilling_InvoiceId` and `Name`, which FSM fills. Zoho answers 500 rather than 400 for a field it does not know, so the names are the first thing to try. `GET /fsm/v1/settings/fields?module=Invoices`, which would have said so, is refused with `401 OAUTH_SCOPE_MISMATCH` on this refresh token — so the scope may want widening too.
  - **The owner then raised it by hand**, at 14:54 India time: FSM's **INV-000001**, id `8229000000304418`, on WO13, contact "Staging test", dated 2026-09-23, status Draft, carrying `ZBilling_InvoiceId` `4242595000000064030`. In Books that invoice is real and right: INV-000001, draft, total 2000, one line "Service visit × 1 = 2000", `tax_total` 0. `GET /books/v3/invoices/4242595000000064030?accept=pdf` answers **200 `application/pdf`**. Everything downstream of the invoice's ID works.
  - **Second, and this is the defect: nothing carries that ID into the mirror.** `src/domain/fsm-mirror.ts` reads `Invoice_Id` off the **appointment**, and FSM leaves it **null** there even after the invoice exists (checked at 09:43 UTC, after the appointment's own `Modified_Time` had moved to 14:54 India time). The work order's own fields are no better: it flips to `Billing_Status: "Invoiced"` and carries no invoice ID. ~~The link lives only on the Invoice record, which names its `Work_Order` and its `ZBilling_InvoiceId`.~~ **That last sentence was wrong, and the evening run below corrects it: the work order's service lines do carry `Invoice_Id`.**
  - So `appointments.fsm_invoice_id` stays null however long one waits, and `GET /api/documents/ab7b388c-…` keeps answering **`409 not_ready`** — the app shows E3's "The invoice is still generating" for an invoice that has been generated. A client would never see their tax invoice.
  - ~~**What would fix it:** find the invoice by listing `/fsm/v1/Invoices` and matching `Work_Order.id`…~~ **Superseded.** Both halves were taken up the same evening, and neither needed the list. See below.
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
- **An invoice cannot be raised over FSM's API, and once raised by hand the mirror never finds it** (open point 114). FSM leaves `Invoice_Id` null on the appointment and gives the work order no invoice ID either, so `appointments.fsm_invoice_id` stays null and the app shows "still generating" for an invoice that exists. It is the one link missing from an otherwise working path. — **Both halves were wrong about FSM and right about us. Taken up the same evening; see below.**
- **"Convert to Work Order" over the API creates no work order** (open point 33). A Request converted that way is left at "Work In Progress" with nothing behind it. — **Right about the transition and wrong about FSM. Taken up on 24 September 2026; see below.**
- **A Zoho auth outage refunds paid bookings.** Minting access tokens by hand alongside the Worker exhausted Zoho's refresh quota for about ten minutes; every FSM call on staging failed with `Access Denied`, and three bookings in flight were given up on after five attempts and refunded, with an alert each (open point 32). The outage was this proof's doing, and it recovered on its own, but the behaviour it exposed is the owner's to rule on. — **Ruled 27 September 2026 (item 141): hold it and alert ops. Built 29 September 2026 (ADR 0095): such a booking now keeps its slot and its payment, is tried every hour for a day, and waits for ops.**

### The invoice, taken up again (23 September 2026, evening)

Open point 114 had two halves — the API would not raise an invoice, and a hand-raised one could not be found — and both were taken up against the same org that evening. Both were ours. Zoho's [Create an Invoice](https://www.zoho.com/fsm/developer/help/api/create-invoice.html) makes three fields mandatory: `Work_Order`, `$Service_Line_Items` and `$finance_data`. The morning's attempts sent the work order and neither of the others.

**A work order was made for the tries**, `8229000000305514`, "Staging test: invoice by API", one Service visit line `8229000000305520`, ₹2,000, at 15:06:43 India time. Nothing of the owner's was written to; WO13 was read and not touched.

| `POST /fsm/v1/Invoices` with                               | FSM answers                                                                             |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `Work_Order` alone                                         | **`500 INTERNAL_ERROR`**, `"details": {}` — the morning's answer, reproduced            |
| `Work_Order` and `$Service_Line_Items`, no `$finance_data` | **`200`**, `code 2031`, "One or more line items are already invoiced" — a plain refusal |
| all three                                                  | **`201`**, `finance_data: { code: "2030", Invoice_Id: "4242595000000064041" }`          |

So the 500 is what FSM does when there are no line IDs to walk: it throws before it validates, and the missing field is never named. With the line IDs present it answers a business refusal like any other module. The refresh token's scope was enough for the create all along — `settings/fields?module=Invoices` still refuses it, but that is a different scope — and the field names were not the problem either: `Contact_Id` and `Date` are FSM's own, filled from the work order.

- **The invoice it raised**: FSM `8229000000305524`, **INV-000002**, draft, on that work order, `ZBilling_InvoiceId` **`4242595000000064041`**. In Books: INV-000002, draft, total 2000, balance 2000, customer "Staging test", `tax_total` 0; `GET /books/v3/invoices/4242595000000064041?accept=pdf` answers **200 `application/pdf`**.
- **An FSM invoice is a link, not the document.** `GET /fsm/v1/Invoices/{id}` answers Books' own invoice payload — `line_items` with Books item IDs, `payment_terms_label`, and `record_actions` including "Unlink Invoice" — wrapped in a few FSM fields. Books is where a Mane Man invoice lives; FSM's Invoices module is the door.
- **FSM will invoice a work order that is not closed.** `8229000000305514` was still `Status: "New"` when the invoice was raised. Our own pass only offers a job FSM has completed, which is the rule we want, not one FSM enforces.

**Finding one already raised needs no listing.** The morning's record said the work order "carries no invoice ID at all". That is true of the work order's own fields and false of its **service lines**. Read back that evening, untouched, WO13 gives:

```
work order Billing_Status: Invoiced
work order top-level Invoice_Id: (no such field)
service line SVC-16 Invoice_Id: 8229000000304418 Billing_Status: Invoiced
```

`8229000000304418` is INV-000001, the one the owner raised by hand, and reading it gives `ZBilling_InvoiceId` `4242595000000064030` — the Books ID `books.invoicePdf` takes. So the link is one read of the work order, and `/fsm/v1/Invoices`, which takes no filter and grows with every job the business ever does, is never listed.

**What is built on it** is `fsm.invoiceWorkOrder`, one call that answers the invoice a work order's lines already name and raises one only when they name none, and a five-minute pass that puts its `ZBilling_InvoiceId` into `appointments.fsm_invoice_id` (ADR 0055). The mirror no longer writes that column from the appointment's null `Invoice_Id`.

#### The provider itself, run against the org

Not the shapes a test asserts: `src/providers/fsm-zoho.ts` as it stands, given the FSM credentials the Worker uses and the access token this session had already minted. A job was run in FSM for it the way our own booking makes one — work order `8229000000304478`, appointment `8229000000306324`, Dispatch at 18:57, then Start Work and Complete Work, then the work order Completed and Closed.

- **It found the owner's invoice.** `invoiceWorkOrder("8229000000305234")` — WO13 — logged `invoice_work_order` 200 then `invoice` 200 at **13:39:17 UTC** and answered `{ id: "8229000000304418", booksInvoiceId: "4242595000000064030" }`. Two reads, no write: the owner's evidence was not touched.
- **It billed the closed job.** `invoiceWorkOrder("8229000000304478")` logged `invoice_work_order` 200 then `create_invoice` **201** at **13:39:26 UTC** and answered `{ id: "8229000000304506", booksInvoiceId: "4242595000000063068" }`. In Books: **INV-000003**, draft, ₹2,000, balance ₹2,000, customer "Staging test", `tax_total` 0, one line "Service visit × 1 = 2000". `GET /books/v3/invoices/4242595000000063068?accept=pdf` answers **200 `application/pdf`** — the same call `GET /api/documents/{visit_id}` makes.
- **Asked again, it raised nothing.** The same call at 13:39:32 logged `invoice_work_order` then `invoice` — two reads, no create — and answered the same two IDs. That is the path a job the owner invoices by hand takes.

### Issuing it, and showing it beside the visit (23 September 2026)

The owner ruled that the invoice is marked sent as it is raised, and shown on the visit's own screen (ADR 0056). **Nothing here was run against the owner's org, and no Zoho record was created by it**: issuing is an accounting act, and the rule that no existing draft is ever sent means the code cannot be exercised against the org without first raising a fresh invoice there. What is proven is the code around it.

- `test/worker/fsm-invoices.test.ts` covers the pass, including the two that matter: a draft the work order already had is **never** sent, whoever raised it, and a send Books refuses leaves the invoice unshown, logs `invoice_not_issued` and alerts ops, and is not tried again.
- `test/worker/app/client-visits.test.ts` and `test/worker/app/client-payments.test.ts` hold every client-facing door — `document_id`, `documents.invoice` and `GET /api/documents/{id}` — to waiting for `invoice_issued_at`, so a draft answers `409 not_ready` as it did before it was raised.
- `e2e/app/fitted.e2e.ts` shows the three states on the real screen at 390 px, with axe at WCAG 2.2 AA on two of them.

**What would prove it on staging:** deploy, deal with the backlog's drafts by hand first (they are never sent from code), then run one service job in FSM to a close and watch a five-minute pass log `invoices_raised` with `issued: 1`; read `invoice_issued_at` on the appointment; open `GET /api/documents/{visit_id}` with a client session; and check in Books that the invoice reads Sent and that the client's advance has been applied to it by the next Books pass.

### What staging cannot prove yet

- **Nobody signed in.** Staging messages only its allowlist, so the login code never leaves the Worker for a test number, and the sessions here were written by hand. The code path itself — `POST /api/auth/otp`, then `POST /api/auth/verify` — needs the owner's handset.
- **The prices and the tax.** FSM's service items were created at the design's placeholder prices (ADR 0032), and GST is 0% in the price book and off in Books (open points 1, 2 and 3). A receipt proves the path, not the figure. The invoicing route itself waits on the CA's answers.
- **The photographs are FSM's.** Until our technician app (P2-M4), a set depends on the technician naming files by phase and angle, and FSM's app uploads them at full size, several megabytes each (open point 125). This proof's ten were made for it, 80 KB each, so nothing here says what R2 will hold in practice. The job-sheet template is a placeholder (open point 28), so `visits.partial_reason` stays empty, `what_was_done` is null in `/visits`, and a partial outcome cannot be proven with its reason.
- **One technician.** The owner is the only FSM user and technician (open point 27), so nothing about work between technicians is proven here.
- **The trial's clock.** FSM and Books are on trials that end around 6 October 2026 (open point 18). After that FSM drops to Free, which has no assets or job sheets, so this proof must be run before then, or after a subscription.
- **Production's side is absent.** Production holds `FSM_PROVIDER`, `BOOKS_PROVIDER` and `PAYMENTS_PROVIDER` at `none` until Phase 2's release, and its photographs bucket and its FSM queue are not created (open points 85 and 86).
- **The invoice pass has not run on staging, and the app has not served a tax invoice.** What is proven is the provider, against the real org, and the five-minute pass around it in `test/worker/fsm-invoices.test.ts`. What is not is `raiseInvoices` running on the staging Worker, writing `appointments.fsm_invoice_id`, and `GET /api/documents/{visit_id}` streaming the PDF to a signed-in client. The evening's session had the Zoho credentials and no Cloudflare API token, so staging's database and its logs could not be read and no session row could be written; staging was also mid-release for another branch. **What would prove it:** deploy this commit to staging, run one service job in FSM to a close, then watch a five-minute pass log `invoices_raised`, `SELECT fsm_invoice_id FROM appointments WHERE fsm_id = …`, and open `GET /api/documents/{visit_id}` with a client session.

### Converting a Request, taken up again (24 September 2026)

Open point 33 had stood as a capability FSM lacks. It is the same shape as the
invoice: ours, not FSM's (ADR 0064). Run against the same org, on its own
"Staging test" records; **REQ4 `8229000000304279` was read and not touched, and
is left stranded as the evidence it is**.

- **Why the transition reports success and does nothing.**
  `GET /fsm/v1/Requests/{id}/actions/blueprint/transitions` on a Request at "New"
  declares `Convert to Work Order` as `action_type: "RECORDACTION"`,
  `next_field_value: "Work In Progress"`, and — unlike `Cancel` and `Terminate`,
  which each declare a mandatory `Notes` field — **no `fields` at all**. There is
  nothing to supply and nothing built from it: the transition writes `Status`.
  FSM says so itself, answering `"message": "record updated"`.
  - Reproduced twice, on two Requests of ours: the bare
    `PUT .../actions/blueprint` with the transition ID, and the same call
    carrying `Type`, `Due_Date`, `Territory` and `Service_Line_Items` under
    `data`. Both **200 SUCCESS**, both moved the Request to "Work In Progress",
    and the org held the same work orders before and after. A richer body changes
    nothing, because the transition was never what creates the work order.
- **What does convert it.** `POST /fsm/v1/Work_Orders` takes a **`Request`**
  field. With it: **201**; the work order came back carrying
  `Request: { name: "REQ8", id: … }`, and the Request, read afterwards, was
  **"Work In Progress" with that work order in its `Work_Orders`** — with no
  blueprint call at all. The status follows the link.
- **Also found, and it settles the tray's asked window** (ADR 0063). REQ4's
  `Preference` read back unchanged three days on:
  `Preferred_Date_1 2026-09-25`, `Preference_Note "Morning, 9 am to 12 pm"`. A
  **service appointment's** own `Preference` subform, however, is read-only:
  sent at create it is dropped (201, all four fields null), and sent as an edit
  it answers `"record updated"` and stays null. A **work order's** `Preference`
  is writable and reads back. So the asked window is reached through the work
  order's `Request`, and never off the appointment.
- **What FSM answers about availability** (ADR 0062). `Available_TimeSlots`
  answered for tomorrow, six days out and twenty days out, and at six days left
  out the morning an appointment already held. The "at most 48 hours" in
  `fsm-trial.md` was read off the documentation and never tried; it is corrected
  there. What FSM will not answer is leave: `Time_Off` exists and is empty, and
  takes a `Time_Off_Type` whose list lives in FSM's Setup screens.
- **Every record made for this was deleted the same session**, and the org was
  read afterwards to confirm it held the three Requests it held before: contact
  `8229000000305643`, Requests `8229000000305648`, `8229000000305659` and
  `8229000000306401`, work orders `8229000000305664` and `8229000000305677` with
  their service lines, and appointment `8229000000304694`.
- **What staging cannot prove here:** nothing was deployed for this. It is the
  API against the org, not the Worker; no code of ours converts a Request.

## P2-M3: referrals and the waitlist

Pincodes, a client's code, the invite and its preview image, attribution, the waitlist, the credit ledger, the first-fit grant with its fraud holds and ops' review, the pincode launch and the pre-January import (ADRs 0048 and 0033). The code is checked in `test/worker/referrals/referrals.test.ts`, `referral-grants.test.ts`, `referral-cards.test.ts` and `credit-bookings.test.ts`.

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

**What this proof left in the owner's Zoho org**, to be removed with the rest of staging's test records (open point 19): four FSM contacts, `8229000000304260`, `8229000000305248`, `8229000000305253` and `8229000000305258`, of which the last was anonymised by the deletion proof below; and one consultation appointment, `8229000000304263`. In D1 the rows this proof arranged are named so they can be found: two appointments `staging-proof-m3-fit-a` and `-fit-b` with their visits, two try-on jobs and one credit grant under `staging-proof-expiry`.

- [x] **A referred consultation is booked through the invite.**
  1. The referrer was made by booking a consultation on the site itself, `POST /api/consultation` at 07:46:26 (Janpath, 110001, 24 September, morning): 201, and the fsm-sync consumer booked it into FSM 7 s later as appointment `8229000000304263`.
  2. `GET /api/refer` with the referrer's session gave code **STE2V4** and the link `https://staging.maneman.in/r/STE2V4`, balance 0, card `house` at version 1, nobody fitted. `SELECT code, card_state, card_version FROM referral_codes;` agreed.
  3. `GET /api/r/STE2V4` on `staging.maneman.in` answered `valid`, card house at version 1, and `referrer_first_name: null` — correct, because the referrer had not yet agreed to photographs on referral cards. Once that consent was switched on, the same call named them "Staging". Each call raised `referral_codes.opens`.
  4. `GET /api/pincodes/110001` answered served, area "Janpath", city Delhi; `400001` answered `served: false` with a null area; `999999` was refused `400 invalid_request`, field `pin`.
  5. `POST /api/r/STE2V4/consultation` answered **201** each time it was used, with the date, the window, the area and `credits: true`. `SELECT via, grant_state FROM referral_attributions WHERE code = 'STE2V4';` showed `consultation` and `pending` for each friend.
- [ ] **The referred consultation reaches FSM.** **Failed, and fixed in this pull request.**
  - Every consultation booked through the invite failed to reach FSM. The log line is `booking_failed … "reason": "the person has no city to give FSM"`, first at 07:50:32 and again on each of the five attempts; the fsm-sync consumer then gave the slot back, and the hold went from `held` to `released`. The friend had a place in D1 and no visit anywhere else.
  - The cause is ours. `fsmContactOf` reads the contact's city from the person's saved address, else from their latest lead. A friend who arrives through an invite has neither: the landing never asks where the hair loss is, so their booking leaves no lead at all (open point 119), and they have saved no address yet. The one place the city is known — the pincode they booked at — was not read.
  - Proven by arranging the opposite: a third test friend was given an address through `PATCH /api/profile/address` and booked again, and `create_contact` then answered 201 with the contact kept on the person.
  - **The fix** is in `src/domain/fsm-contacts.ts`: the city falls back to the city of the pincode on the person's referral attribution. `test/worker/referrals/referrals.test.ts` › "reaches FSM, using the invite's pincode for the city the friend's booking never asks for" fails without it. (Corrected 27 September 2026: the landing now takes the friend's address (ADR 0081), and a booking's own pincode names the city before either fallback, so that test is now "reaches FSM, with the address the friend gave and the city of the pincode they booked at"; the fallback to the invite's pincode stays for a contact added with neither.) It is **not yet proven on staging**, because staging was carrying other proofs at the same hour and deploying under them would have disturbed them. What would prove it: deploy this commit to staging and book one consultation through an invite from a number with no address, then see `create_contact` and `fsm_synced` instead of `booking_failed`.
- [x] **A first fit that closes as done leads to the grant.** The closing itself was arranged, not run.
  - Closing a job in FSM is P2-M2's and P2-M4's path, and `visits` is only ever written by the FSM mirror. Two first-fit appointments (`staging-proof-m3-fit-a` and `-fit-b`, status `completed`) and their two visits (outcome `done`) were therefore written into D1 directly, and the real five-minute cron did the rest. So what is proven here is the referral pass, not the mirror.
  - At **08:00:54.999** the pass logged `referrals_settled` with `granted: 1, held: 1, invites_expired: 0, credits_expired: 0, clawed_back: 0`, and filled each attribution's `first_fit_appointment_id`.
- [x] **Both people are credited.**
  - `SELECT person_id, kind, visits, expires_at FROM credit_ledger WHERE source_kind = 'referral';` holds one grant of **3 visits** to the friend and one to the referrer, both created 08:00:51.734 and both expiring **2027-09-23T08:00:51.734Z**, exactly 365 days on. The attribution is `granted`.
  - `GET /api/refer` then showed `visits: 3` with that expiry, and a tracker of one entry: the friend's first name and `2026-09`, nothing else. `GET /api/me` carried the same credit tile. The app's own Refer tab (F1) at 390 px reads "When a friend you refer is fitted, you both get 3 service visits free.", "Your credit", "Expire 23 Sep 2027", "3"; "See who has been fitted" (F5) lists the friend with "Fitted Sep 2026" and "3 visits earned", under "Completed fits only. Whether an invite was opened is your friend's business."
- [ ] **The referrer is messaged.** **Needs the owner's handset.** The message was made and queued as the grant was written: `SELECT kind, state FROM outbound_messages WHERE kind = 'friend_fitted';` is one row, `friend_fitted`, state **`skipped`**, `last_error` "number not on the allowlist", 0 attempts. That is correct for a random test number. What would prove it: run the same grant with the referrer's number on `MESSAGING_ALLOWLIST`, and see the state `sent` and the placeholder `friend_fitted_v2` text on the handset (`friend_fitted_v1` until ADR 0107 made each side's visits ops' to set) (open point 39).
- [x] **A same-address pair lands in review, and ops decide it on the real screen.**
  - The second friend's address was saved through `PATCH /api/profile/address` with the referrer's own first line and pincode. The same 08:00:54 pass held that grant instead of granting it: `grant_state` `held`, `fraud_signals` `["shared_address"]`, no credit row and no message.
  - The ops console's **Referrals** section at `ops-staging.maneman.in/referrals` showed "Held for review 1", the pair as "Staging test → Staging test", "Fitted Wed 23 Sep", the rule lettered **SAME ADDRESS**, and Approve and Reject. Under it, "All referrers": Opens 4, Consults 3, Fits 2, Granted 1, Redeemed 0.
  - **Approve** asked for a reason first ("Why you are approving it — Kept with the decision, in the audit log") and only the second press sent it. `POST /api/referrals/31205e1a…/decision` answered 200, the queue emptied, and D1 holds `grant_state` `approved` with `reviewed_by`, `review_reason` and `reviewed_at`. `SELECT action, subject_id FROM audit_log WHERE action = 'referral.decide';` holds the decision. Both sides then had a second grant of 3 visits, written 08:02:38.527.
  - **Who the audit names.** The console was reached with the `mm-ci-staging` service token, so the decision is recorded under that token's name, not a founder's. A member of staff signing in with their own Access login would be named instead; that half is not proven here.
  - **A small defect:** after a decision the "All referrers" panel is not read again. It still said Granted 1 until the page was opened afresh, when it said 2. Nothing is wrong in the data.
  - The other three rules (`shared_upi`, `monthly_cap`, `same_mobile`) are still only in `test/worker/referrals/referral-grants.test.ts`.
- [x] **After a revoke, a fresh share shows the house card — and so does an old one.**
  1. A 1000 × 600 JPEG was refused `422 photo_invalid_file`. A **synthetic** 1200 × 630 JPEG of 7,687 bytes — three flat colour bands, no photograph of anyone — was accepted: `{"version": 2}`, `card_state` `personal`.
  2. `GET /api/og/STE2V4.jpg?v=2` returned exactly those 7,687 bytes, byte for byte the same SHA-256, as `image/jpeg` with `Cache-Control: public, max-age=86400`. The landing's own tags then read `og:image … /api/og/STE2V4.jpg?v=2` and `og:title "Staging sent you a Mane Man invite"`, rewritten by `mm-site` from the invite, so a crawler that runs no JavaScript sees them.
  3. `DELETE /api/refer/card` answered 204: `card_state` back to `house`, version 3, `card_key` cleared. `GET /api/og/STE2V4.jpg?v=3` answered **302 to `/images/invite-house.jpg`**.
  - **More than the prompt asks.** `?v=2`, the old share's own link, also answers 302 to the house card, because the revoke deletes the stored object as well as moving the version on. So a revoke reaches old shares too, as soon as WhatsApp fetches the preview again, and the version only decides how soon. The record until now said a revoke reached new shares only.
  - Switching the consent off does the same: the card was uploaded again (version 4), `PATCH /api/consents/photos_referral_cards {"granted": false}` took it down (version 5, `house`), and the invite stopped naming the referrer.

### Also proven with this milestone

- [x] **The waitlist.** `110004` (Rashtrapati Bhawan) was set unserved for the test. `POST /api/r/STE2V4/waitlist` answered 201 with the area and `credits: true`; a second person joined through the site's own `POST /api/waitlist` without the launch alert; and `POST /api/r/STE2V4/consultation` on that pincode was refused `422 not_bookable`. The ops console's **Waitlist** section showed one row: `110004  Rashtrapati Bhawan  Count 2  Oldest 23 Sep  Ref 1  Alerts 1`.
- [x] **The launch, from the console.** Choosing the pincode only asked what a launch would send: "This messages 1 person", On the list 2, Opted in to alerts 1, Held referral invites 1, the placeholder text itself, and the note "The 1 who did not opt in are not messaged." The second press launched it: "Launched. 1 on their way." `serviceable_pincodes` has `served = 1` and `launched_at` 2026-09-22T18:30:00Z (today, in India); `waitlist_entries.alerted_at` filled at 08:04:21.879 for the one entry that asked to be told and stayed null for the other; and `audit_log` holds `pincode.launch` on subject `110004`. The alert itself is `launch_alert`, state `skipped`, "number not on the allowlist". The pincode was put back as it was afterwards.
- [x] **The back-fill import.** `node scripts/ops/import-referrals.ts staging --file data/referrals/sample-referrals.csv` wrote "3 referrals into staging": `referral_codes` 3, `referral_attributions` 7, `credit_ledger` 10 of which 6 came from the import — four grants of 3 visits each, and two `adjust` rows of −1 and −2 for the credits the log says were already used. Run a second time it wrote nothing: every count was the same. The real log is the owner's (open point 49).

### What this proof found

- **An invited friend's consultation never reached FSM** (above): fixed here, not yet re-proven on staging.
- **`referral_attributions.consultation_appointment_id` was never written by anything.** The column has existed since migration 0021 and no code filled it, so ops' record did not name the consultation an invite produced. `confirmBooking` now fills it when it books a consultation, and `test/worker/referrals/referrals.test.ts` checks it.
- **The invite publishes prices the price book does not hold.** The landing at 390 px offers "First fit, from … Standard base ₹25,000" and "Service visit … ₹1,500". The price book has held ₹30,000 and ₹2,000 since 22 September (`SELECT item, amount_ex_gst, valid_from FROM price_book;`), which is what the app charges. The figures come from `site/src/content/site.ts` and nobody reconciles them. This is exactly the risk open point 11 names, on the first page a friend sees. **Fixed 26 September 2026** (ADR 0073): the site and the landing read the price book.
- **Zoho's token budget is one budget for every proof.** From 07:55 the FSM calls began failing with `Zoho 400 Access Denied: could not refresh the access token`, straight after a `401` on a call the same token had just served. One refresh token mints at most 10 access tokens per 10 minutes (`docs/archive/fsm-trial.md`), and another proof was running against the same org at the same hour. Nothing in our code is wrong; the budget is shared, and two proofs at once can exhaust it. Recorded as open point 32.

### What staging still cannot prove

- **The chat itself.** The landing renders and its Open Graph tags are right, but how WhatsApp draws the invite on an Android and an iOS handset (boards B1 and B2) can only be seen on a handset. The card is composed by hand here; composing it in the browser from the client's own visit photographs is the app's, and was not exercised.
- **The message on a handset.** Only allowlisted numbers receive anything, delivery receipts are not set up on the shared Evolution instance (open point 38), and the texts are placeholder (open point 39).
- **The house card is a placeholder:** two tones and the gold rule, no photograph (open point 52).
- **Every pincode is served** on staging (open point 48), so "not served" had to be arranged by hand and the real service area is not proven.
- **With self-serve booking off**, the landing now records a request for ops instead of refusing (ADR 0059); staging runs with the flag on, so the requested path is covered by tests and not by this proof.
- **The other three fraud rules** are covered by tests only. `shared_upi` could be shown on staging by paying both visits from the same test UPI handle.
- **A first fit closed in FSM.** The grant was settled from appointments written into D1, so the leg from FSM's Completed through the mirror to `visits.outcome = 'done'` is P2-M2's to prove, not this one's.

## P2-M5: self-serve booking and money

The price book, availability, holds, Razorpay Checkout, credit redemption, moving and cancelling under the 24-hour rule, refunds and late fees, all behind `SELF_SERVE_BOOKING` (ADRs 0045, 0046 and 0033). The code is checked in `test/worker/booking/client-booking.test.ts`, `bookings.test.ts`, `visit-changes.test.ts`, `credit-bookings.test.ts` and `test/node/policy/policy-moving-a-visit.test.ts`, and the app's own flow in `e2e/app/booking.e2e.ts` and `e2e/app/changes.e2e.ts` against a faked Checkout.

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
  - **What is not proven** is the page: C6's countdown reaching zero and offering the windows again could not be seen, for the reason above. Nor was the other half of ADR 0045 — a capture arriving after the hold has lapsed, refunded in full and claimed on the hold so a repeat cannot refund twice — which needs a payment made and left to settle past ten minutes; it is covered by `test/worker/booking/bookings.test.ts`.
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
  - Our `refunds` row followed from Razorpay's webhook, and the five-minute pass recorded it in Books as `4242595000000072002`, from `BOOKS_REFUND_ACCOUNT_ID` (open point 10). The payment is now `refunded` with `refunded_amount` 200000.
  - `GET /api/payments` shows the refund entry with `destination: "netbanking"` and `speed: "normal"`, above the payment it came from.
- [ ] **With `SELF_SERVE_BOOKING` off, booking, reschedule and cancel answer `409 ops_assisted`,** and the app opens WhatsApp to ops with the visit named. **Not run.** It needs a staging version deployed with the flag off and staging then put back on the pipeline's version, and staging was shared with two other proofs that morning. The refusal itself is `{"error":{"code":"ops_assisted",…}}` from the middleware in `src/routes/client/booking.ts`, and it is covered by `test/worker/booking/client-booking.test.ts` and `visit-changes.test.ts`.

### What the proof found

- **The app cannot open Checkout**, so no visit can be paid for in the client app at all. It is the first thing to fix, it is fixed in this branch, and it needs a deploy of `mm-app` to staging before anyone can say the app's own money screens work. Until then the C6, C7 and C8 screens are unproven, whatever the API underneath them does.
- **The screens the app draws before paying are right**, at 390 px: the price, the inclusive figure, the ten-minute countdown, "Free to move until …", and the two methods.
- **Razorpay's webhook is already live on staging** and answered every event we needed — authorised, captured, failed, and a refund — so open point 5 is done for staging.
- **Zoho's auth quota reaches into the money.** While FSM could not be reached, three paid bookings were refunded after five attempts (open point 32). Nothing in this proof's own bookings was lost, but the rule is worth a ruling.

### What staging cannot prove yet

- **No real money.** Test keys only; KYC, live keys and a live webhook wait for production (open point 6). Netbanking's simulated bank page is what decided each outcome, so nothing here says how a real bank or a real UPI app behaves.
- **Nobody signed in**, as in P2-M2: the sessions were written by hand, so the login the client would use is not part of these results.
- **The figures are the design's.** Prices, the late fees, the late-cancel refund and the change copy are placeholders, or our reading of the rule, and the owner has still to confirm them (open points 1 and 7). The design does not draw the way from C7 to C8 either. What the proof does show is that the figures the app and the API use are the price book's: ₹2,000 a service visit, ₹30,000 a first fit, ₹4,000 the first fit's late fee.
- **GST is 0%.** The app shows the ex-GST figure as the main number with the inclusive figure beside it; with GST off the two are equal, so the proof shows the plumbing, not the arithmetic (open points 2 and 3).
- **No refund voucher.** Books gives no PDF for a refund that we have found, so the entry carries its destination and a **Notify me** that asks ops on WhatsApp (open point 9).
- **Self-serve is on in staging and off in production** (open point 8), so what production will do is only ever shown by turning the flag off deliberately.
- **A move to another technician** is dispatch's, in P2-M4, and there is one technician on staging in any case (open point 27).

## P2-M6: DPDP readiness

Erasure reaching Phase 2's data and the FSM contact, the client's own export, grievances, the retention jobs and a breach runbook (ADR 0049, on top of ADR 0019's erasure). The code is checked in `test/worker/privacy/dpdp.test.ts` and `erasure.test.ts`.

### The check the prompt asks for

From `docs/prompts/phase2-backend.md`, P2-M6:

> **P2-M6 — DPDP readiness** (roadmap Stage 4, before 14 May 2027): access and deletion requests end to end, retention jobs verified, and a breach runbook.

### Staging proof, 23 September 2026

Run in the same sitting as P2-M3 above, on the same staging version, with the same test people: "Staging test" with random `9xxxxxxxxx` numbers, each given a client session written into `sessions` by hand because a login code would have to reach a handset. **The person erased below is one this proof created this morning**, checked against their own `people.id` before the call; nothing else was erased and production was not touched.

- [x] **An access request, end to end.** `GET /api/me/export` answered 200 with `Content-Disposition: attachment; filename="maneman-my-data.json"` and `Cache-Control: private, no-store`. The file holds `exported_at` and then `person`, `addresses`, `consents`, `visits`, `payments`, `refunds`, `credits`, `referral`, `messages`, `grievances` and `try_ons` — the whole list the record asked for. A friend's file was 818 bytes and the referrer's 1,487. Consents carry their notice version (`referral-consultation-v1`); credits carry the kind, the visits and the expiry; **messages carry the kind, the state and the date and nothing else**. Nobody else's data appears, apart from the technician's display name on a visit, which the app shows that client anyway. `SELECT action, actor_kind FROM audit_log WHERE action = 'data.export';` records each one under the client, `actor_kind` `client`.
- [x] **A grievance, end to end.** `POST /api/grievances` answered 201 with the ID and `open`. `GET /api/grievances` on `ops-staging.maneman.in` listed it with the client's name, number, words and date. `POST /api/grievances/{id}/resolve` answered `{"state":"resolved"}` and the list emptied. `audit_log` holds `grievance.raise` under the client and `grievance.resolve` under the member of staff. The route's alert names the grievance's ID and nothing else (`src/routes/client/data.ts`), but it goes to the alert webhook, so **the owner is to confirm the message reached the Google Chat space**.
  - **The console has no Grievances screen.** The alert's own words are "answer it in the ops console", and the console has Dispatch, Clients, No-shows, Referrals, Waitlist, Tasks and Technicians and nothing else. Both grievance routes were API-only that day. Recorded as open point 134, settled on 24 September 2026 by #97: the console has Grievances, Deletion requests and Number changes (ADR 0078).
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
     - **Left behind:** the two `photo_sets` rows survive with no photographs in them. They hold an appointment ID and the word "before" or "after", so no personal data, but they are a loose end. Recorded as open point 135.
  4. `SELECT erased_at, crm_erased_at, fsm_erased_at, fsm_erasure_attempts FROM people WHERE id = '<person_id>';` filled all three: `crm_erased_at` 08:15:54.119 on the first attempt, `fsm_erased_at` 08:15:54.969, both **2 min 55 s** after the erasure. Not seconds, as Phase 1's was: the ops route does not queue the CRM and FSM work itself, as `POST /api/erasure` does; the five-minute sweeper picks up anyone erased more than two minutes ago. It is within the runbook's "a few minutes", but it is slower than the other door. Recorded as open point 136.
  5. The Worker's logs over the whole sitting hold neither number, in either form, nor any name; the lines carry IDs and counts.
  - **In Zoho.** The blanking of the CRM record and the anonymising of the FSM contact are recorded as done by our side on the first attempt. What the two records now look like in the org, and whether their timelines still hold the old values, is the owner's to confirm (ADR 0019, open for legal).
- [x] **The retention jobs.** Nothing waits 7 days or 365 in a proof, so each was shown by arranging a row and letting the real five-minute cron find it.
  - **The 7-day window.** A deletion request was back-dated to 18 September. The 08:15:48 pass alerted once and set `alerted_at` to 08:15:51.053. The next pass left it alone: `alertAgedDeletions` only matches `alerted_at IS NULL`, so it cannot alert twice.
  - **Credit expiry.** A grant of 2 visits was written for a test client, expiring at 08:16:00. Before that, `GET /api/me` read `{"visits": 2, "earliest_expiry": "2026-09-23T08:16:00.000Z"}`. The 08:20:48 pass logged `referrals_settled … credits_expired: 1` at 08:20:50.961 and wrote one `expire` entry of **−2** against that grant at 08:20:49.975; `GET /api/me` then carried no credit tile at all (`credits: null`). The 08:25:48 pass wrote nothing and logged no `referrals_settled` line at all: `credit_ledger` still holds exactly one `expire` row.
  - **The clawback.** A granted first fit was marked refunded in full (`payments.status = 'refunded'`, kind `visit`). The 08:15:48 pass logged `referrals_settled … clawed_back: 1` at 08:15:53.334 and wrote a `clawback` of **−3** against each side's grant at 08:15:51.868; the attribution is `clawed_back`; and the referrer's balance fell from 6 to 3, leaving only the grant ops had approved. The friend they had referred dropped out of their tracker with it.
  - **Try-on retention.** Two jobs were arranged with their own synthetic images, so no one else's try-on was touched. A `ready` job whose `expires_at` was 30 days past became `expired` and its result was deleted from `mm-staging-tryon-results`; its upload was deleted from `mm-staging-tryon-uploads` and `upload_deleted_at` set to 08:15:45.153, an hour after the job. A job left `awaiting_upload` for three hours became `expired` too.
- [ ] **The breach runbook.** **Walked through as far as staging allows.** The scenario was a leaked Worker secret.
  - **What was checked.** `wrangler secret list --env staging` names the 21 secrets that `W secret put … --env staging` would rotate, `ALERT_WEBHOOK_URL`, `ERASURE_SECRET`, `EVOLUTION_API_KEY`, `OTP_PEPPER`, `RAZORPAY_KEY_SECRET`, `RESULT_SIGNING_KEY`, `ZOHO_*` and the rest among them, so step 1's first command has a real target and the list is the right one to work down. `UPDATE sessions SET revoked_at = …` was run against this proof's own three sessions, which is step 1's last command, and the next request with one of those cookies was refused `401 session_required`.
  - **What was not run, and why.** Rotating a live secret, revoking a Zoho, Razorpay or Evolution key in its console, signing an ops user out of Cloudflare Access, turning a surface off in `wrangler.jsonc` and rolling a Worker version back all change staging for everyone using it, and two other proofs were running the same morning. Each is the owner's to rehearse in a quiet hour. What would prove them: one sitting with staging to itself, rotating `RESULT_SIGNING_KEY` and putting it back, and rolling `mm-api` to the previous version and forward again with `scripts/release/release.ts`.
  - **The notices are addressed to nobody.** No Grievance Officer is named and the runbook's contacts are missing (open point 51), so steps 4 and 5 can be read but not rehearsed.

### What staging still cannot prove

- **Nobody to notify.** No Grievance Officer is named, the 30-day answer time in the app is a placeholder, and the breach runbook's contacts are missing (open point 51). The notification steps can be rehearsed, but they are addressed to no one.
- **The app's copy is a placeholder.** The design draws no "Your data" card, so its words are ours until the owner approves them (ADR 0049, open point 42).
- **Deletion in FSM is anonymisation, not deletion.** The contact stays, with its name, numbers, e-mail and street cleared and its city kept (ADR 0049). Zoho's own timeline may still hold the old values, as the CRM's may; that is open for legal (ADR 0019).
- **The 8-year invoice retention** cannot be shown, only stated: nothing deletes an invoice, and Books holds them.
- **Deletion within 7 days in production** is not proven by a staging run. Production holds its FSM, Books and payments providers at `none` until Phase 2's release, so an erasure there reaches fewer places today than it will.
- **Ops had no screen** for grievances, deletion requests or number changes, so every DPDP action ops take was an API call here, and how a member of staff would find and answer one is not proven (open point 134). The screens came with #97 on 24 September 2026 (ADR 0078) and are proven by their browser tests; no member of staff has yet answered one on staging.

## P2-F4: the technician app against the real mm-api, 23 September 2026

PR #84 shipped the technician app's job screens and its service worker, and said plainly that **the app had never spoken to a real mm-api**: every browser test and the fidelity harness fake the technician API in the browser. This is the first run over the wire.

The app is the one deployed on `https://tech-staging.maneman.in`, and mm-api is the deployed `mm-api-staging`. It was run twice: against version `f6d314a9`, tag `5578d95` — PR #84's own merge — and again after PR #85 went out to staging, against version `8151eb30`, tag `91c9e30`. Both runs gave the same answers, and the figures below are the second one's. Every request went over real HTTPS through real Cloudflare Access with the `mm-ci-staging` service token. Nothing was faked: no `page.route()`, no stubbed `fetch`, no local Worker.

### How it was run

`npm run test:tech-staging` (`playwright.staging.config.ts`, `e2e/tech-staging/`). It is a config of its own and not a project of `playwright.config.ts`, because CI holds no Access credentials and a pull request must not fail when staging is down.

The fixtures (`e2e/tech-staging/seed.ts`) are written straight into `maneman-staging` with `wrangler d1 execute --env staging --remote`, the way `e2e/app/fitted.ts` writes the local database, and taken out again afterwards, rows and R2 objects alike. They are a technician called "Staging Technician", a client called "Staging test", a Gurgaon address with coordinates, and three service visits — today, tomorrow, and three days out. Both mobile numbers are random `9xxxxxxxxx` test numbers, as every staging proof since M2 has used; India publishes no reserved test range for mobiles. No real person's name, number or photograph is anywhere in this run. The photographs are Chromium's fake camera device: a green test pattern.

**Two things in this run are not the real thing, and both are named where they matter below:**

- **The right code.** Staging hashes every login code under `OTP_PEPPER`, a Worker secret, and refuses a fixed code outside local (`src/config/settings.ts`). So a desktop cannot read a code, and the only affordance for a real one is a handset on staging's messaging allowlist, which would mean sending a WhatsApp to a person. The proof therefore walks the code request and a wrong code through the app for real, and writes the session row that `openTechnicianSession` would have written. Everything after sign-in is a real session that the deployed API validated on every call.
- **FSM.** The mirror rows are ours, so no Zoho FSM appointment stands behind them, and every job event's FSM write failed with `Zoho 404 INVALID_URL_PATTERN`. `fsm_write_state` stays `pending`, which is what the API hands the app and what the app shows. The FSM leg of a technician's write is **not proven here**; it belongs to P2-M2's parallel run and to the field test.

### What each check returned

| #   | Check                                           | What the deployed API answered                                                                                                                                                                                                                                                                                                                                                                                    | Result                                                                             |
| --- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1   | **Sign-in, with `device_id` on both calls**     | A code request with no `device_id`: `400 invalid_request`, `fields: ["device_id"]`. From the app, with it: `202 {challenge_id, expires_in_s: 600}`. The verify carried it too.                                                                                                                                                                                                                                    | **pass**. PR #84's fix is real against the deployed API, not only against the fake |
| 2   | **A wrong code**                                | `200 {"verified": false, "attempts_left": 4}`, and the screen showed "That code did not match. 4 tries left."                                                                                                                                                                                                                                                                                                     | **pass**                                                                           |
| 3   | **`GET /tech/me` after a reload**               | `200 {"name":"Staging Technician","first_name":"Staging","initials":"ST","device":{"device_id":…,"label":"Chrome on the proof's desktop","enrolled_at":…}}`. The reload kept the session, and the chip read ST                                                                                                                                                                                                    | **pass**                                                                           |
| 4   | **The day's list, and the day-before unlock**   | `GET /tech/jobs?date=…`: one job, `sector "Sector 24"`, `badge "prepaid"`, `unlocked true`, `unlocks_at 2026-09-21T18:30:00Z`. Tomorrow's card carried the address. The card three days out: `unlocked false`, `address null`, `client null`, the sector still given, and the screen showed "The address and the client's card open the day before."                                                              | **pass**                                                                           |
| 5   | **Check-in, through the browser's geolocation** | Outside: `{"passed": false, "distance_m": 612, "radius_m": 200, "wait_ends_at": null, "accepted": null}`, and the screen said "You are 612 m from the address." Inside: `{"passed": true, "distance_m": 39, "radius_m": 200, "wait_ends_at": +15 min}`, and the wait began. Both are in `checkins`: 612 m failed, 39 m passed, radius 200 on each                                                                 | **pass**                                                                           |
| 6   | **A photograph upload, all the way**            | Five `POST …/photos/upload-url` → `201`; five `PUT /api/tech/photos/<token>` → `204`; then `POST …/photos` → `202` with `steps_done: ["before_photos"]`. Five rows in `photos`, one per angle, 18,282 to 26,826 bytes, under `visits/<job>/before-<angle>-<uuid>.jpg` in `mm-staging-client-photos`                                                                                                               | **pass**, though the sizes mean nothing (below)                                    |
| 7   | **The outbox across a real network cut**        | With `context.setOffline(true)`, Start job queued on the phone and `job_events` held **0** `start` rows. Signal back: **1**. The same `X-Client-Event-Id` sent again answered `202 {"replayed": true}`, and `job_events` still held **1**                                                                                                                                                                         | **pass**                                                                           |
| 8   | **A revoked device**                            | `POST /api/technicians/{id}/devices/{device}/revoke` on `ops-staging` → `200 {"revoked_at": …}`. The phone's next `GET /tech/me` → `401 device_revoked`; the app showed the sign-in with "This phone is no longer signed in. Ask ops, then sign in again."; the `mm-tech-day` cache was gone; `technician_devices` held both `revoked_at` and `wiped_at`                                                          | **pass**                                                                           |
| 9   | **The deployed service worker**                 | After a reload the caches were exactly two: `mm-tech-shell-15ff189ef4a8`, holding `/` and ten hashed assets, and `mm-tech-day`, holding one entry, `/api/tech/jobs?date=2026-09-23`. Nothing for a job's card, `/tech/me`, the piece lookup or a photograph, each of which was asked for from the page the worker controls. Offline, the app closed and reopened showed the day and "No signal · working offline" | **pass**                                                                           |

### What the proof found

- **A write from outside a page is refused, and that is worth saying.** The first run's direct `POST /api/tech/auth/otp` got `403 forbidden_origin` before anything else: `src/http/origin.ts` demands an `Origin` of the host's own on every write. The app is never affected, since a browser sets one; a script is. The harness now sends it, and the refusal is checked as its own assertion.
- **The photograph sizes here prove nothing about a real camera.** The five frames were 18 to 27 KB, because Chromium's fake device is a flat green pattern. ADR 0039's budget assumes about 250 KB a frame from a real one. Open point 125 is still open, and the field test is what closes it.
- **A passing check-in never shows the technician the distance.** Board B5 draws a distance only on the failed state, so the number open point 56 needs cannot be written down at the door; it has to be read out of `checkins` afterwards. `docs/tech-field-test.md` collects it that way, and gives the one command ops run. Whether the app should show the distance on a passing check-in is a change to a board the designer drew, and is the owner's to rule.
- **No technician's FSM write reached FSM, for a stated reason.** The fixtures are mirror rows with no Zoho record behind them, so each event failed with `Zoho 404 INVALID_URL_PATTERN` and was retried. The teardown removes the events promptly, so the fifth attempt finds nothing and the run never alerts ops. The alerts in the Worker's log during this run are another surface's bookings, not this one's.
- **Nothing was sent to anybody.** The code request for the seeded technician logged `login_code_skipped`, "number not on the allowlist". The request for a number FSM does not list sent nothing at all, and answered the same `202`, as the route intends.
- **A technician seeded into the mirror is a technician the booking availability offers.** During the second run something else using staging took a slot on him and released it, and that hold then stopped the teardown deleting him: `slot_holds.technician_id` is a foreign key. A hold like that exists only because of this fixture, so the teardown now takes the claims and the holds out with it.
- **One teardown did not finish.** D1 answered it `{"D1_RESET_DO":true}` and left the whole fixture in staging, which is how the hold above came to light. The fixtures were removed by hand and staging checked clean; the teardown now tries its statements twice.

### What staging cannot prove, and what proves it

`docs/tech-field-test.md` is the script for a real Android phone at a real client's door, written for someone who is not a developer. It covers what simulation cannot reach:

- **the camera** in bright sun, in a basement, and with gloves on;
- **real GPS error**, with `distance_m` captured at a Gurgaon high-rise, a gated sector house and a basement — the evidence open point 56's 200 m ruling needs;
- **a real dead spot**: a whole job in aeroplane mode, then reconnected, checked for anything lost or doubled;
- **the phone locked** and the app reopened mid-job, at three points;
- **battery and heat** over a full working day.

It also carries the one leg of sign-in this run could not walk: a real login code, on a real handset, end to end.

### The login code, sent for real, 24 September 2026

The run above proved the code request and a wrong code, and said plainly that **the right code had never been through the real API** because no desktop can read one. Half of that gap is now closed: a code was asked for against the deployed staging API for the owner's own handset, and the deployed Worker sent it. The other half — the six digits opening a session — is the owner's to walk, and `docs/technician-test-setup.md` is the page they walk it from.

**What was put into staging, and what it is.** A technician row written straight into `maneman-staging` with `wrangler d1 execute --env staging --remote`, by `scripts/staging/seed-technician-tester.ts`, which takes the number from the environment and never writes it down:

| Row                  | What                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One technician       | `fsm_id` `tech-tester-522a73f9`, name "Test Technician", initials TT, `active` 1, `zone` Gurgaon, `mobile_e164` the owner's own — the one row that carries it |
| One client           | "Staging test", a random `9xxxxxxxxx` test number, contactable                                                                                                |
| One address          | Sector 45, Gurgaon, pincode 122003 (a served pincode), **no `lat` or `lng`**                                                                                  |
| Three visits         | Service visits at 10:00 India on 24, 25 and 27 September, all `scheduled`: a job today, a job tomorrow, and a third that is still locked                      |
| No device or session | On purpose. The point of this fixture is that a person signs in himself, and the first sign-in enrols the phone (`openTechnicianSession`)                     |

The address has no coordinates deliberately. An address with none cannot be measured against, so the check-in is accepted wherever the phone is (`src/domain/check-ins.ts`) and the owner is not obliged to stand in Sector 45 to see the rest of the app. The 200 m geofence stays `docs/tech-field-test.md`'s to measure, at real addresses.

**The code was sent, and here is the evidence.** `POST https://tech-staging.maneman.in/api/tech/auth/otp`, with an `Origin` of the host's own and the `mm-ci-staging` Access service token, answered `202 {"challenge_id":…,"expires_in_s":600}`. The challenge row is in staging's `otp_challenges`, with `technician_login` 1, `technician_id` the row above, and `code_hash` **not null** — which only happens when the number matched an active technician, since a challenge for an unrecognised number holds no hash at all. Then, from `wrangler tail --env staging`:

```json
{
  "level": "info",
  "event": "login_code_sent",
  "time": "2026-09-24T01:41:01.125Z",
  "worker": "mm-api",
  "environment": "staging",
  "surface": "tech",
  "request_id": "1df4a1f2-a97b-4a4f-8549-1142b8e3d5dc",
  "channel": "whatsapp"
}
```

`login_code_sent` is written only when the WhatsApp provider accepted the message (`src/http/send-code.ts`). A number off staging's allowlist logs `login_code_skipped` instead, which is what every earlier proof saw, and a provider refusal logs `login_code_failed`. Neither appeared. The code itself was never read, and the session was not opened: that is the owner's to do, on their phone.

**The fixture was read back through the deployed API, so the owner will not meet an empty list.** A session was written the way `openTechnicianSession` writes one, bound to a throwaway device ID, and taken out again immediately afterwards; staging holds no technician session or device now. Through it, `GET /api/tech/me` answered `200 {"name":"Test Technician","first_name":"Test","initials":"TT",…}`; `GET /api/tech/jobs?date=2026-09-24` answered one job, `sector "Sector 45"`, `badge "prepaid"`, `unlocked true`; the card carried the address, the access note and the client; and the 27 September card answered `unlocked false`, `address null`, `client null`, with the sector kept. The job's steps came back as five — `before_photos`, `checklist`, `consumables`, `after_photos`, `outcome` — because a service visit skips the piece.

**`outbound_messages` holds nothing for a login code, and is not where to look.** There is no `login_code` kind in `MESSAGE_KINDS`, and `sendCodeAfterResponse` hands the code straight to the provider rather than queueing a row, so that a real send takes no longer to answer than a challenge that sends nothing (ADR 0030). The newest row in the table is still the previous day's `visit_reminder`. The Worker's log is the delivery record for a code, and the four events above are the whole of it.

**The technician login does not depend on FSM.** `findFieldTechnician` reads `technicians` in D1 and nowhere else. `POST /api/tech/auth/otp` calls FSM only when that read comes back empty, and then only as a refresh so that a technician added to FSM today does not wait for the nightly reconciliation. The row above has no Zoho record behind it, and the send above is the proof that none is needed. Open point 27 is corrected accordingly: it governs how a real technician's number reaches the mirror in production, not whether this test can be run.

**Added 27 September 2026: from 25 September FSM's list did decide whether this row stayed active.** #113 (ADR 0065) made each read of FSM's technician list switch off every technician the list leaves out, and FSM lists only the owner's own user. So the nightly reconciliation, or any sign-in with a number the mirror did not know, would switch the row above off, and the owner's code request would then answer `202` and send nothing, with nothing in the log to say so. The owner reported the code not arriving on 27 September. This is its likely cause, found in the code; staging's own rows and logs were not read to confirm it. Since migration 0046 a technician written by hand, by `scripts/staging/seed-technician-tester.ts` or the staging proof, is marked `hand_written`, and the list leaves him alone. A read that switches anyone off logs `technicians_deactivated` with their FSM IDs, and a code request that sends nothing logs `login_code_not_sent` with its reason: "no account holds the number", or "number not on the allowlist", the event called `login_code_skipped` above. The supported way for the owner to be listed is their own mobile number on their FSM user (open point 27).

**Two things about the fixture that are not faults but will be noticed.**

- **Every job event will fail to reach FSM.** The visits are mirror rows with no Zoho appointment behind them, so each step is retried four times and then marked `rejected`, and the fifth attempt alerts ops: "A technician's `start` did not reach FSM after 5 attempts…". About six alerts over one job, roughly seven minutes behind each step. PR #87 avoided these by tearing its fixture down before the fifth attempt; this fixture has to stand, so they will fire. `docs/technician-test-setup.md` warns the owner to tell whoever watches the alert channel. **From 25 September 2026** (ADR 0065) a job's steps wait for the one before them, so only the check-in is retried: its fifth attempt alerts and names the steps held behind it, and each later step alerts as it arrives, without retrying.
- **An active technician is one the booking availability offers**, so anything else using staging can take a slot on him while the fixture stands, exactly as happened during the run above. `scripts/staging/seed-technician-tester.ts --clear` takes the claims and the holds out with everything else, and it is what removes the owner's number from staging again.

## FSM removal, PR 3: the Books provider on the org, 2 October 2026

The provider's new calls, run through the real adapter against the owner's org with the scripts' Books token: `node --env-file=.env.books-scripts scripts/staging/books-proof.ts`. Every record it made is "Staging test", and it removes them again. It made 19 calls of Books' 2,000 a day.

| #   | Check                                                                   | Answer                                                         |
| --- | ----------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1   | A customer is added under a new person ID (`PUT /contacts`, `X-Upsert`) | **PASS**, 201                                                  |
| 2   | The same person ID finds the same customer, with a new street           | **PASS**, 200, the same ID                                     |
| 3   | A new number is written over it, and reads back                         | **PASS**                                                       |
| 4   | A place of contact is refused while GST is off in Books                 | **PASS**, 400 code 8 "Invalid Element gst_treatment"           |
| 5   | A new rate is written over an item, and reads back from the list        | **PASS**, ₹2,000 to ₹2,500                                     |
| 6   | No invoice is found under a new reference                               | **PASS**                                                       |
| 7   | A draft of ₹2,000 with ₹150 off before tax totals ₹1,850                | **PASS**, 201, INV-000006, draft                               |
| 8   | The draft is found by its reference                                     | **PASS**                                                       |
| 9   | Erasing a customer the draft names renames, blanks and deactivates it   | **PASS**: Books refused the delete (400 code 3000), so blanked |
| 10  | Erasing it again once the draft is deleted deletes it                   | **PASS**, then 404 on reading it                               |

**What the org said, which the code now follows.** While GST is off in Books, `gst_treatment`, `place_of_contact` and `place_of_supply` are each refused, on a customer and on an invoice alike, so the provider sends them only with a state code; until GST is turned on, the caller passes none. Contact persons sent on an update replace those Books holds. An item-level discount before tax is accepted on a new invoice. The scripts' scopes cannot delete an item (401 code 57), so the proof keeps one item, "Staging test: proof item" (`4242595000000245041`), and reuses it on every run. Each run uses up one invoice number: INV-000004 to INV-000006 went to the exploratory calls and the two proof runs, and were deleted.

**Not proven by these two runs:** making an item, which only a first run does (`POST /items` answered 201 on the exploratory calls, making `4242595000000245041`); and GST's treatment and places, which wait for GST to be turned on in Books.

## FSM removal, PR 10: staging off FSM

Run once staging is switched (docs/runbook.md, "Staging left FSM"), as a real user with staging's test records, backdating rather than waiting. Not run yet.

| #   | Check                                                                    | Answer |
| --- | ------------------------------------------------------------------------ | ------ |
| 1   | A consultation booked on the site                                        |        |
| 2   | A paid first fit booked in the app                                       |        |
| 3   | A visit booked by ops                                                    |        |
| 4   | A dispatch move and a reassign                                           |        |
| 5   | A technician's whole day on a phone                                      |        |
| 6   | A partial job                                                            |        |
| 7   | A no-show                                                                |        |
| 8   | A cancel with a refund                                                   |        |
| 9   | The invoice issued and the payment applied; the receipt and the PDF open |        |
| 10  | The CRM Contact appears after Books' Instant Sync, with "MM person ID"   |        |
| 11  | An erasure blanks the Books customer, and the CRM Contact follows        |        |
| 12  | A technician added in the console signs in                               |        |

If check 11 fails, the CRM Contact is blanked directly instead: CRM Contacts access (open point 21), about a day's work.

## Zoho's answers, read through the adapters, 4 October 2026

Every read the Books and CRM adapters make, run through the adapters against the owner's org with the scripts' tokens, so each answer was read by the adapter's own schema: `node --env-file=.env.books-scripts --env-file=.env.crm-scripts scripts/release/zoho-contract-probe.ts --record` (RB, "Checking Zoho's answers before a release"). Nothing was written; 13 calls, 03:42 IST.

| #   | Read                                                              | Answer                                                                      |
| --- | ----------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | Books' items, a page at a time                                    | **PASS**, 6 items                                                           |
| 2   | An invoice, its PDF, and an invoice found by its reference        | **SKIP**: the org holds no invoice                                          |
| 3   | No invoice under a new reference                                  | **PASS**                                                                    |
| 4   | A payment found by its customer and our reference, `MM-2026-0016` | **PASS**: the first time this search ran on the org                         |
| 5   | That payment's receipt                                            | **PASS**, a PDF                                                             |
| 6   | A refund found on its payment by Razorpay's refund ID             | **PASS**: the first time this search ran on the org                         |
| 7   | No refund under a new reference                                   | **PASS**                                                                    |
| 8   | A Lead found by its person ID, and none for a new person ID       | **FAIL**, 401 `OAUTH_SCOPE_MISMATCH`: the scripts' token has no Leads scope |

**What it changed.** The adapter tests now read the org's own answers to the payment and refund searches (`test/fixtures/vendors/books/payments-by-reference.json` and `refunds-of-payment.json`, with no one's details), where before they read shapes written from Books' documentation. Books applies the payment search's two filters exactly (`comparator: "equal"`), and the adapter still compares each reference again.

**Owed.** The CRM's scripts' token has only the settings scopes, so the Lead search is not yet read on the org: a new code with `ZohoCRM.modules.leads.READ` and `ZohoSearch.securesearch.READ` added (RB, Zoho, step 7), then the probe again with `--record`, which writes `test/fixtures/vendors/crm/lead-search.json` for the CRM tests to load. Read 2 waits for the first invoice the D1 path raises on staging.

## What the P2-M2 and P2-M5 proofs left in the owner's org

Staging shares the real Zoho org (open point 19), so the records below are real and are the owner's to keep or clear. Every one of them is labelled "Staging test". Nothing was deleted, because two of them are still wanted: **WO13 carries the invoice the owner raised by hand**, INV-000001, which the invoice check still waits on for the reason in open point 114; and the first fit is the visit a move was proven on.

**Zoho FSM.** Two contacts, `8229000000305231` and `8229000000304356`, both "Staging test" with random numbers. Two Requests, `8229000000304279` (REQ4, left at "Work In Progress" with no work order, for the reason in open point 33) and `8229000000306245`. Five work orders with an appointment each:

| Work order       | Appointment      | What it is                           | Left as                                    |
| ---------------- | ---------------- | ------------------------------------ | ------------------------------------------ |
| 8229000000305234 | 8229000000304285 | The service job, with 10 photographs | **Closed, invoiced by hand as INV-000001** |
| 8229000000306229 | 8229000000304341 | The paid service visit, then moved   | Cancelled, refunded                        |
| 8229000000305384 | 8229000000306251 | A credit booking, moved by ops       | Cancelled at late notice                   |
| 8229000000306269 | 8229000000304388 | A credit booking                     | Cancelled at free notice                   |
| 8229000000305397 | 8229000000306278 | The first fit, moved at a late fee   | **Scheduled, 30 September**                |

**Zoho Books.** Three customer payments — `4242595000000067002` (₹2,000), `4242595000000069003` (₹30,000) and `4242595000000071002` (₹4,000) — and one refund, `4242595000000072002` (₹2,000), each described "Staging test: Razorpay …". Also the draft invoice FSM raised on WO13, `4242595000000064030` (INV-000001, ₹2,000, no tax). No payment is applied to it, because it is a draft, and nothing in the code will ever send it (ADR 0056): it stays the owner's to send or delete.

**What the evening's invoice work added**, all "Staging test" and all the owner's to clear:

| FSM record                             | What it is                                                    | Left as                             |
| -------------------------------------- | ------------------------------------------------------------- | ----------------------------------- |
| Work order `8229000000305514`, WO19    | Made to try the create against, one ₹2,000 Service visit line | `New`, `Billing_Status: "Invoiced"` |
| Invoice `8229000000305524`, INV-000002 | The first raised by API, on that work order                   | Draft                               |
| Work order `8229000000304478`, WO20    | The end-to-end job, one ₹2,000 Service visit line             | Closed, invoiced by the provider    |
| Invoice `8229000000304506`, INV-000003 | Raised by `fsm.invoiceWorkOrder` on WO20                      | Draft                               |
| Appointment `8229000000306324`         | Its visit, 19:00–20:30 on 23 September, one technician        | Completed                           |

In Books that leaves two more draft invoices, `4242595000000064041` (INV-000002) and `4242595000000063068` (INV-000003), ₹2,000 each, no tax.

**Razorpay** holds the test-mode orders, payments and the refund. They are test data and need no clearing.
