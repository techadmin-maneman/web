# Prompt for the coding agent — Mane Man Phase 1 backend, rev 4.1

_Paste verbatim. Supersedes rev 4, which it changes in one respect: the image integration now builds on the working AILabTools harness at `C:\Users\X2\Side projects\AILabTool` and on the measurements recorded there. Rev 4 in turn superseded rev 3.1. Rev 4 aligns the backend to the final Claude Design (Mane Man Site v2), which is fixed: the booking form takes a city, not a pincode; Delhi NCR's five cities are served and other cities join a waitlist; the try-on gate appears while the render is still running and promises a WhatsApp copy of the result; the booked page shows a proposed visit day. The platform is Cloudflare Workers with static assets. Backend and infrastructure only — no UI._

---

## How to work

Build in **four milestones**. Stop at the end of each, open a pull request, and do not start the next until the milestone's definition of done is met and the PR is merged. Do not deliver the whole system in one pass.

When this prompt is ambiguous, write the question and your chosen assumption into `docs/decisions/` as an ADR and proceed. When this prompt is wrong about a platform fact, stop and say so rather than working around it.

---

## Reference implementation — read before M3, and before any code that touches AILabTools

A working AILabTools integration already exists at `C:\Users\X2\Side projects\AILabTool`. You built it. It was tested against the live API on 19 Sep 2026. **Read it; do not modify it.**

**Read, in this order:**
1. `docs/API_NOTES.md`. The measured facts in its section 7 override anything in this prompt about AILabTools behaviour. Where they conflict, follow the measurement and record the conflict in an ADR.
2. `app/client.py` — the three code paths, per-endpoint field names and response shapes, multipart part naming, pre-flight, download retries and key scrubbing.
3. `cloudflare/src/index.js` — the same integration running as a Worker: the multipart build with `task_type=async`, `auto=1` and `image_size=1`; the credits sum across pools; the `task_status === 2` check; PNG detection by magic bytes; the 3-try download.
4. `presets.yaml` and `catalog.json` — the validated style ids: 101 male styles, all accepted by Pro.
5. `cloudflare/public/` — the browser-side resize, re-encode and hair-colour detection. The front-end task will need it; note where it lives in `docs/reference/README.md` and do not port it here.

**Copy into this repo:**
- `docs/API_NOTES.md` → `docs/reference/ailabtools-api-notes.md`, verbatim, with a header naming the source path and date.
- `catalog.json` → `data/ailabtools-catalog.json`.

CI cannot see the Windows path, so everything the build and tests depend on must live in the repo.

**Never copy, open, print or commit:**
- `.env`, `cloudflare/.dev.vars`, `cloudflare/.studio-password.txt` (live secrets).
- `inputs/`, `out/`, `cache/`, `refs/`. These hold photographs of real people. They must not become fixtures, test data or examples. Use synthetic or licensed fixture images only.
- Any `.wrangler/` state.

**Do not replicate these patterns from the harness.** They were right for a single-user test tool and are wrong here:
- **Client-driven polling.** The harness hands the `task_id` to the browser. Here the browser never sees a provider task ID, and polling happens server-side in the `render` consumer. Claim-before-ready depends on it.
- **The shared-password gate.** Replaced by Turnstile, rate limits and the spend ceiling.
- **The R2 result cache with no expiry.** Every object here sits under the 30-day lifecycle.
- **The R2 CSV log.** Replaced by D1 `events` and structured logs.
- **The single-file layout.** Use the provider adapter structure in this prompt.

**Measured facts this build must honour** (`API_NOTES` section and reference in brackets):

| Fact | Consequence here |
|---|---|
| Endpoint A is dead: 404 `ERROR_AI_NOT_EXISTS` (7.1) | Never call it. |
| Pro (B) preserves the face; Premium (C) visibly altered face shape on a Norwood VII subject (7.7) | **Pro is the default endpoint.** A customer must recognise himself in the result. |
| Pro has no "keep original colour" option and defaults to blonde (7.5) | Every Pro call sends an explicit `color`; see the `hair_color` contract below. |
| Pro needs `task_type=async`, `auto=1`, `image_size=1`; Premium has none of these fields (3, 4) | Build the form per endpoint; never share one field set. |
| Pro returns `data.images[]`; Premium returns `data.image` (0, 3, 4) | Parse per endpoint. |
| `image_size` above 1 returns byte-identical copies at the same price (7.12) | Always 1. |
| Premium validates the filename extension; a wrong extension returns a misleading `502 "AI service internal error … File type not supported"` (7.2) | Name the multipart part and set its content type from the actual bytes. Classify this 502 as `photo_invalid_file`, not as an outage. |
| Measured latency: Pro 17–49 s, Premium 80–91 s (7.6) | 180-second cap. |
| Failed calls bill 0 credits (7.6) | See pre-validation below. |
| Results are served from `ailab-outputs.oss-accelerate.aliyuncs.com`, which stalls; generation is billed even when delivery fails; URLs live 24 hours (7.10) | Download without the API key, 3 tries at 20 s each. On failure, keep the URL and retry **the download only** until it expires. Never re-render a billed image. |
| Results are PNG whatever the name suggests (`index.js`) | Set content type from magic bytes. |
| The credits response is an array of pools that must be summed (0) | Use this in the credit monitor. |
| No published error-code table (5) | Classify by HTTP status plus message; store the scrubbed `error_detail` on the job for later analysis. |
| Whether the model renders thick straight black Indian hair convincingly is unverified (7.8) | Settled by the preset bake-off, not by you. |

## Architecture, fixed

Two Workers on one zone, same origin, no CORS between them:

- **`mm-api`** — owns every binding and secret. Handles `https://{host}/api/*` through a zone route, plus the `queue` handlers for `render` and `crm-sync` and the `scheduled` handler for the sweeper. This task builds it.
- **`mm-site`** — Astro static assets, everything outside `/api/*`. The front-end task builds it later. Create only a placeholder that serves one page per environment so routing can be tested.

No Pages project. No origin server. No self-hosted component.

## Environments

Three, fully isolated. No resource, secret or third-party account is shared between staging and production.

| | local | staging | production |
|---|---|---|---|
| Host | `localhost` via `wrangler dev` | `staging.maneman.in`, behind Cloudflare Access, `noindex` | `maneman.in` |
| D1 | local SQLite | `maneman-staging` | `maneman-prod` |
| R2 | local | `mm-staging-tryon-uploads`, `mm-staging-tryon-results` | `mm-prod-tryon-uploads`, `mm-prod-tryon-results` |
| Queues | local | `*-staging` | `*-prod` |
| Zoho | stub | Zoho CRM Developer Edition org | production Zoho CRM org |
| AILabTools | stub (fixtures shaped exactly like the responses in `docs/reference/ailabtools-api-notes.md`) | real key, daily render ceiling 20 | real key, production ceiling |
| Turnstile | Cloudflare's always-pass test keys | staging widget | production widget |
| WhatsApp BSP | stub | BSP sandbox or a test sender, messages to founders' handsets only (allowlist) | production sender, `MESSAGING_ENABLED` true only once the result template is approved |
| Analytics | off | GA4 debug mode | GA4 production property |

Declare staging and production as `wrangler` environments (`[env.staging]`, `[env.production]`) with every binding repeated explicitly per environment. **A binding that is not redeclared inside an environment block must fail the config check in CI**; inheriting a top-level binding is how staging writes to production.

The Worker reads `ENVIRONMENT` and refuses to start if it is missing, if it disagrees with the D1 database name, or if a production Worker holds a stub provider.

## CI/CD — GitHub Actions

- **Every pull request:** typecheck, lint, format check, unit tests, contract tests, a config check proving every environment redeclares every binding, a dependency audit, and a build. All required checks on `main`.
- **Merge to `main`:** apply D1 migrations to staging, deploy `mm-api` to staging, run the smoke suite against `staging.maneman.in`.
- **Production:** a separate workflow behind a GitHub Environment with required reviewer approval. Applies D1 migrations to production, uploads a new Worker version, promotes it with a gradual deployment, runs the smoke suite, and rolls back automatically if smoke fails.
- Cloudflare API tokens in CI are scoped per environment. The staging token cannot touch production resources.

**Migrations are forward-only and backward-compatible with the code currently deployed** (expand, deploy, then contract in a later release). Migrations run before code deploys. A migration that would break the running version is a failed review.

## Engineering standards

- TypeScript `strict`, plus `noUncheckedIndexedAccess`. No `any`, no non-null assertions, no `@ts-ignore` without a linked ADR.
- **One schema library (zod) is the single source of truth** for request validation, response shapes, the contract tests and `docs/api.md`. Generate the OpenAPI document from the schemas; never hand-write it.
- ESLint with `typescript-eslint` strict, Prettier, and exact dependency versions with a committed lockfile. Renovate for updates.
- Every request gets a request ID, returned in a response header and carried through queue messages.
- Structured JSON logs only, through one logger that redacts name, mobile, email and image keys by field name. A test asserts redaction. Workers Logs and observability enabled in both remote environments.
- `POST /api/lead` and `POST /api/tryon/claim` accept an `Idempotency-Key` header; a repeat within 24 hours returns the original response rather than creating a second lead.
- Every external call has an explicit timeout.
- Errors returned to clients carry a stable code and the request ID, never a stack trace or a provider message.
- Coverage threshold of 85% lines on `src/`, enforced in CI.

## Design principles

1. D1 is the system of record for anything a client touches, under our own UUIDs. Zoho IDs are foreign references only.
2. A lead is durable in D1 before any external system is contacted. Zoho being down never produces a user-facing error.
3. Every external provider sits behind an interface with a stub. No caller imports a vendor module.

## Bindings and secrets, per environment

Bindings: `DB`, `UPLOADS`, `RESULTS`, `RENDER_QUEUE`, `CRM_QUEUE`, `MESSAGE_QUEUE`.

Secrets: `AILAB_API_KEY`, `TURNSTILE_SECRET`, `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ACCOUNTS_HOST`, `ZOHO_API_HOST`, `ZOHO_LAR_ID`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (scoped to that environment's upload bucket, used only to sign presigned PUT URLs), `BSP_API_KEY`, `BSP_BASE_URL`, `RESULT_SIGNING_KEY`, `ERASURE_SECRET`, `ALERT_WEBHOOK_URL`. Plain vars: `ENVIRONMENT`, `MESSAGING_ENABLED`, `WA_RESULT_TEMPLATE`, `VISIT_LEAD_DAYS` (default 2), `UNKNOWN_COLOR_ROUTE` (`premium_original` by default, or `pro_black`), `AILAB_CREDIT_FLOOR` (alert threshold, in credits), every rate-limit threshold, the render ceiling.

## Data model

Numbered migrations under `migrations/`.

- `people` — `id` (uuid), `created_at`, `mobile_e164` (unique), `name`, `email` (nullable), `zoho_lead_id`, `contactable` (bool, true only once a `contact` consent exists), `erased_at`.
- `cities` — `name` (pk), `served` (bool), `active`, `sort`. Seed: Gurgaon, Delhi, Noida, Faridabad, Ghaziabad served; Mumbai and Bengaluru not served. The page's city list is read from `GET /api/cities`, so opening a city is a data change, not a deploy.
- `leads` — `id` (uuid), `person_id`, `created_at`, `source` (`form` | `waitlist` | `tryon`), `city` (nullable for try-on leads), `first_choice_window` (`weekday_am` | `weekday_pm` | `weekend_am` | `weekend_pm`, nullable for try-on leads), `loss_extent` (`crown` | `receding` | `advanced`), `proposed_visit_date` (nullable), `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `gclid`, `fbclid`, `referrer`, `landing_path`, `sync_state` (`pending` | `synced` | `failed`), `sync_attempts`, `last_sync_error`, `synced_at`, `request_id`.
- `consents` — append-only: `id`, `person_id`, `purpose` (`contact` | `tryon_photo` | `result_delivery`), `notice_version`, `granted`, `created_at`, `ip_hash` (salted).
- `tryon_jobs` — `id`, `created_at`, `upload_key`, `stage`, `preset`, `hair_color`, `endpoint` (`pro` | `premium`), `state` (`awaiting_upload` | `queued` | `rendering` | `downloading` | `ready` | `failed` | `expired`), `provider_task_id`, `provider_result_url`, `provider_result_expires_at`, `download_attempts`, `result_key`, `failure_code`, `provider_error_detail` (scrubbed), `latency_ms`, `person_id`, `session_id`, `claimed_at`, `expires_at`, `photo_consent_version`, `photo_consent_at`, `ip_hash`.
- `presets` — a constant module, not a table. Six entries, each `{ id, label, endpoint, hair_style }`, with `hair_style` taken from `data/ailabtools-catalog.json`. A test fails if any id is missing from the catalog. Placeholder values stand until the bake-off lands.
- `tryon_sessions` — `id` (uuid), `person_id`, `created_at`, `expires_at`.
- `outbound_messages` — `id`, `created_at`, `person_id`, `kind` (`tryon_result`), `subject_id`, `state` (`waiting` | `queued` | `sent` | `failed` | `skipped`), `provider_message_id`, `attempts`, `last_error`, `sent_at`.
- `visit_blackouts` — `date` (pk), `reason`. Dates ops will not offer.
- `counters` — `scope`, `key`, `window_start`, `count`; primary key on the first three.
- `idempotency` — `key`, `route`, `response_json`, `created_at`.
- `zoho_token` — single row: `access_token`, `expires_at`.
- `events` — `id`, `created_at`, `name`, `subject_id`, `payload_json`.

No image bytes in D1. Mobile numbers in E.164.

## Endpoints

- `GET /api/cities` — `[{ name, served }]` in display order. Cacheable for five minutes.
- `POST /api/lead` — the booking form. Body `{ name, mobile, city, first_choice_window, loss_extent, consent }`. Turnstile; validate; idempotency; upsert `people`; append a `contact` consent and set `contactable`; if the city is served, `source='form'` and compute `proposed_visit_date`; if not, `source='waitlist'` and no date. Insert lead `pending`, then enqueue `crm-sync`. Respond `201` with `{ lead_id, served, proposed_visit_date?, window_label? }` — the booked page renders its headline ("Thursday, 24 September, before noon") and the waitlist page ("On the list") from exactly these fields.
  - **`proposed_visit_date`:** the first date in IST at least `VISIT_LEAD_DAYS` days after submission that matches the chosen window's day type (Monday to Friday for weekday, Saturday or Sunday for weekend) and is not in `visit_blackouts`. `window_label` is "before noon" for morning and "after six" for evening, matching the design. This is a proposal ops must honour or change on WhatsApp, so it is synced to Zoho and visible on the lead.
- `POST /api/tryon/upload-url` — body `{ photo_consent: true, notice_version }`, `400` unless literal `true`. Record the photo consent on the job; copy it into `consents` as `tryon_photo` at claim. Turnstile; rate limit; attach `session_id` if a valid `mm_tryon` cookie is present; create job `awaiting_upload`; return a presigned R2 PUT URL (`aws4fetch`, S3 endpoint) for a server-generated key, five-minute expiry, `image/jpeg` or `image/png` only, size-capped.
- `POST /api/tryon/generate` — `{ job_id, stage, preset, hair_color }`. `hair_color` is set by the browser's colour detector and is one of `black`, `brown`, `lightBrown`, `grey`, `silver`, `white` or `unknown`. Only the natural shades are accepted. The object must exist and be within limits. Allowlists: six presets, three stages. Apply the rate limit.
  - **Deduplication.** If the same session already has a `ready` or running job for the same upload, preset and colour, return that job instead of rendering again. Pro is non-deterministic, but a second identical render buys nothing the customer can see.
  - Otherwise: atomic ceiling increment (on breach `503` with `failure_code: busy`), set `queued`, enqueue `render`, return `202`.
  - **Colour routing.** When `hair_color` is `unknown`, route by `UNKNOWN_COLOR_ROUTE`. `premium_original` sends the job to Premium with `color=original`, trading face fidelity for correct colour. `pro_black` keeps Pro with `black`. Record the route taken on the job.
- `GET /api/tryon/status/:job_id` — `{ state, failure_code? }` only. `failure_code` is one of `photo_unreadable`, `photo_invalid_file`, `render_failed`, `busy`.
- `POST /api/tryon/claim` — the gate. Body `{ job_id, name, mobile }`. **Accepted in any non-failed state, not only `ready`.** The design shows the gate after a 20-second processing screen while renders take 30 to 180 seconds, so the gate usually arrives before the result: the lead must be captured the moment the gate is submitted. Idempotency; upsert `people`; append a `result_delivery` consent (the gate's own notice, versioned, states the number is used to send a copy); copy the job's photo consent into `consents`; insert lead `source='tryon'`; set `claimed_at`; create a `tryon_sessions` row and set cookie `mm_tryon` (`HttpOnly`, `Secure`, `SameSite=Strict`, 30 minutes); create an `outbound_messages` row for the result in state `waiting`; enqueue `crm-sync`. Respond `201` with `{ lead_id, whatsapp_copy }`, where `whatsapp_copy` is `true` only if `MESSAGING_ENABLED` is true. The front end shows "A copy is on its way to +91 …" only when it is `true`.
- `GET /api/tryon/result/:job_id` — requires a `mm_tryon` session that owns the job. `202 { state }` while the job is running; `200 { url }` with a signed fifteen-minute URL when `ready`; `422 { failure_code }` when failed. "Try another look" uses the same endpoint, without a second gate or a second lead; log `try_on_additional_look` against the existing person.
- `GET /api/result/:token` — HMAC-verified, streams from `RESULTS`.
- `POST /api/erasure` — operator-only. Deletes try-on objects, sets `erased_at`, appends a withdrawal consent, cancels unsent messages, enqueues a CRM update. The consent screen promises same-day deletion; the runbook makes that an ops SLA.
- `GET /api/health` — environment, version ID, D1 reachable.

## Consent model — what each channel may do

- A `contact` consent (booking form) makes the person `contactable`: ops may call and message about a visit.
- A `result_delivery` consent (try-on gate) permits exactly one thing: sending that person his result. The gate tells him "No password, no account, no marketing." A try-on-only person is therefore **not contactable**. Sync him to Zoho with `Contact_Consent = false` and lead status `Try-on — delivery only`, so the chase workflows exclude him. If he later books through the form, the new `contact` consent flips `contactable` and the CRM record updates.
- The code enforces this. The CRM adapter must never set a try-on-only lead to a chase status, and a test proves it.

## Queue consumers and cron

**`render`** — the only caller of AILabTools.

Build every request from the reference. The provider adapter owns all endpoint-specific knowledge.

1. **Pre-flight.**
   - Read the upload. JPEG or PNG only (checked by magic bytes), under 5 MB, 200×200 to 4090×4090 px. The browser has already downscaled and re-encoded it.
   - **No paid pre-validation call by default.** Failed calls bill 0 credits, so the endpoint's own rejection of an unusable face is free.
   - In M3, prove this. Submit a side-profile and a two-face image, read the credits balance before and after as the reference does, and record the result in an ADR. If a rejection does bill, add Face Analyzer Advanced as a pre-check.
2. **Submit.** `multipart/form-data` with header `ailabapi-api-key`, fields per the job's endpoint.
   - Pro: `task_type=async`, `auto=1`, `image_size=1`, `hair_style`, `color`.
   - Premium: `hair_style`, `color`.
   - Name the image part after its real type, for example `portrait.jpg` with `image/jpeg`.
   - Store the `task_id` and set the job to `rendering`.
3. **Poll without holding the consumer.** Check `GET /api/common/query-async-task-result?task_id=…` once per delivery. If `task_status` is not `2`, call `message.retry({ delaySeconds: 5 })`; the delay grows to 10 s after 30 s. Past 180 s from submit, fail with `render_failed`. A non-zero `error_code` fails with a classified `failure_code`, and the scrubbed `error_detail` is stored.
4. **Record, then download.** Store `provider_result_url` (Pro `data.images[0]`, Premium `data.image`) and an expiry 24 h out *before* downloading, then set `downloading`. Fetch without the API key: 3 attempts, 20 s timeout each, content type from magic bytes, write to `RESULTS`. If all 3 fail, re-enqueue a download-only retry with a delay; the sweeper keeps retrying until the URL expires. Only then does the job fail, with an alert, because a billed image has been lost.
5. **Finish.**
   - Set `ready`, `expires_at` at 30 days, and `latency_ms`.
   - If an `outbound_messages` row is `waiting` for this job, move it to `queued` and enqueue it. On `failed`, mark any waiting message `skipped`.
   - Scrub the API key from every error string before it is stored, logged or returned. This follows the reference's `scrub()`.

**`crm-sync`** — the only caller of Zoho. Access token minted from the refresh token, cached in `zoho_token`, refreshed on expiry or 401. New person: insert into `/crm/v8/Leads` with `lar_id` and workflow triggers **only when `contactable`**; a try-on-only lead is inserted without the assignment rule and without chase triggers. Existing person: update and add a note. Map name to `Last_Name` (mandatory), plus `Mobile`, `Email`, the standard `City` field, `Lead_Source`, `Lead_Status`, and the custom fields `First_Choice_Window`, `Loss_Extent`, `Proposed_Visit_Date`, `Contact_Consent`, `Try_On`, `D1_Lead_ID`, `D1_Person_ID`, `UTM_Source`, `UTM_Campaign`. Lead statuses used: `New`, `Waitlist`, `Try-on — delivery only`. Confirm the `lar_id` and trigger syntax against Zoho's v8 docs in an ADR. Backoff; after the last retry, `failed` and alert.

**`messaging`** — the only caller of the WhatsApp BSP. Sends the result as an approved template with an image header, the image URL being a signed result URL with a one-hour expiry minted at send time. If `MESSAGING_ENABLED` is false, mark the row `skipped` and send nothing. Retry transient errors three times; then `failed` and alert. Never send to a person who has been erased.

**Sweeper, every five minutes.**
- Re-enqueue leads `pending` over two minutes or `failed` under ten attempts.
- Re-enqueue messages `queued` but unsent for over five minutes.
- Re-enqueue `downloading` jobs whose provider URL has not expired.
- **Hourly:** read the AILabTools credit balance (sum every pool) and alert when it falls below `AILAB_CREDIT_FLOOR`. An exhausted balance otherwise fails every try-on silently.
- D1 is the replay source. Expire try-on jobs past `expires_at`, abandoned `awaiting_upload` jobs after an hour, and sessions past expiry.

## Provider adapters

`providers/image.ts`, `providers/crm.ts`, `providers/messaging.ts`, each with a real and a stub implementation. `image.ts` exposes `submit(bytes, preset, color, endpoint)`, `poll(taskId, endpoint)`, `download(url)` and `credits()`. Its stub replays the exact response shapes documented in `docs/reference/ailabtools-api-notes.md`, including the 502 file-type trap and a stalled download. `messaging.sendTemplate(to, templateName, params, mediaUrl?)` is implemented against the BSP chosen at the roadmap's 4 Oct gate (AiSensy, Interakt or Wati). Nothing outside the adapter knows which one.

## Rate limits and spend, in D1

Per salted IP hash: 5 upload URLs and 5 generates an hour. Per mobile: 3 claims and 5 leads a day; at most 3 result messages a day. Global render ceiling per day, one conditional `UPDATE ... WHERE count < :cap RETURNING count`; breach returns `503 busy` and alerts. All thresholds are per-environment variables.

## Validation

Indian mobile to E.164 (the design collects ten digits after a fixed +91). Name 1 to 60 characters after trimming. `city` must exist in `cities` and be active. `first_choice_window` and `loss_extent` from their enums. `consent` on `/api/lead` must be literal `true`. Unknown fields rejected.

## Data protection

- **Lifecycle:** 30-day rules on both try-on buckets in both remote environments, asserted by a test.
- **Consent records:** append-only, with the notice version recorded. The texts of all three notices (photo, gate, booking) are versioned in the repo verbatim from the design.
- **Personal data:** none in logs, analytics, errors, `last_sync_error` or `last_error`.
- **Client photos:** do not create a client-photo bucket.

---

## Milestones and definition of done

**M1 — Skeleton, environments, pipeline.** Both Workers deploy to staging and production with placeholder responses; `/api/health` reports the correct environment in each; migrations apply in CI; every PR check runs and is required; the production workflow demands approval and performs a gradual deployment with automatic rollback on failed smoke; the binding-redeclaration check fails a deliberately broken config.

**M2 — Lead path.** Cities endpoint, booking lead with proposed date, waitlist, consents, idempotency, rate limits, `crm-sync` against the Zoho Developer Edition org, sweeper. Staging proof:
- A served-city lead reaches Zoho, assigned and notified, in under 60 seconds, with the proposed date on the record.
- A Mumbai lead lands as `Waitlist`, unassigned.
- With the Zoho token revoked, the browser still gets `201` and the sweeper delivers within five minutes of restoring it.

**M3 — Try-on and messaging.** Reference material copied and read, with an ADR listing every place this build departs from the harness and why. Then: presigned upload with photo consent, generate with colour routing and deduplication, the render consumer with delayed-retry polling and the download-only retry, status, claim before `ready`, session-scoped results and additional looks, spend ceiling, credit monitor, and the messaging queue against the BSP sandbox or a test number. Staging proof:
- A Pro render and a Premium render both complete, with measured latency recorded.
- A deliberately wrong filename extension to Premium is classified `photo_invalid_file`.
- The credits check proves a rejected face bills nothing, or the ADR adds a pre-check.
- A forced download failure recovers from the stored URL without a second billed render.
- A gate submitted while the render is still running creates the lead at once, and the result appears when ready.
- A second look releases without a second gate or a second lead.
- The WhatsApp copy arrives on a test handset, and with `MESSAGING_ENABLED=false` the claim returns `whatsapp_copy: false` and nothing is sent.
- A try-on-only lead is in Zoho as `Try-on — delivery only` and is not assigned.
- The ceiling trips at 3 and returns `503`.

**M4 — Hardening and handover.**
- Erasure, including cancellation of unsent messages.
- Redaction test and the coverage gate.
- A load test of 50 concurrent lead submissions with no duplicates.
- `docs/api.md` generated and the runbook written.
- Then one production release.

## Deliverables

- A repository with `README.md`.
- `wrangler` config for both Workers and both environments.
- `migrations/` and `.github/workflows/`.
- `docs/api.md` and the generated OpenAPI file.
- `docs/decisions/`.
- `docs/runbook.md`, covering:
  - Zoho down, AILabTools down, or the BSP down.
  - Ceiling tripped.
  - Token revoked.
  - Replaying a failed lead or message.
  - D1 point-in-time restore.
  - Erasure within the day.
  - Opening a city.
  - Adding a blackout date.
  - Rolling back a Worker version.
- `docs/verification.md`.

## Out of scope

- Any page, component, style or copy.
- The client app, referral engine, credit ledger and FSM mirror, and launch alerts to the waitlist. The schema must not make any of them harder.
