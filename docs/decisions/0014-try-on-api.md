# 0014. The try-on API

- Status: accepted
- Date: 2026-09-21

## Context

The prompt specifies the try-on endpoints: upload link, generate, status, the gate (claim), results and signed result links. Building them raised one platform fact the prompt had wrong, and several questions it leaves open. The owner decided three of them on 21 September 2026.

## Decisions

### The photo comes through the API, not a presigned R2 link

The prompt asks for a presigned R2 `PUT` URL. A presigned URL can be used any number of times until it expires, and R2 has no one-time URLs. So one five-minute link could be replayed thousands of times, and each replay is a billed R2 write that no ceiling here can count. R2 bills the card past its free allowance (docs/decisions/0009). The R2 docs also document restricting only `Content-Type`, not the size.

The owner chose to route the photo through the API instead:

- `POST /api/tryon/upload-url` records the photo consent and creates the job, as the prompt says. It returns `upload_url`, a path on this host signed for five minutes: `/api/tryon/upload/{job_id}?token=…`.
- `PUT /api/tryon/upload/{job_id}` checks the bytes and writes them to R2. It claims the job's one write in D1 first, so each job writes to R2 exactly once, and a replay gets `409 upload_already_received`.

There are therefore no `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID` or `R2_SECRET_ACCESS_KEY` secrets, no bucket CORS rules, and no `aws4fetch`. `RESULT_SIGNING_KEY` signs the upload link as well as result links; each token names its purpose, so one cannot stand in for the other.

The upload link's body gains `turnstile_token`, because the prompt puts Turnstile on this endpoint.

### Jobs, looks and sessions

- **One job per render.** The first look of a photo is the job `upload-url` created. "Try another look" is a new job that shares the photo (`upload_key`) and points at the first look (`parent_job_id`).
- **Deduplication.** A generate with the same photo, look and colour as a job that is queued, rendering, downloading or ready returns that job. Stage is not compared, because it does not change the render.
- **Before the gate, only the first look.** A different look needs the `mm_tryon` session that owns the job (`403 session_required`); otherwise the gate could be skipped indefinitely.
- **The session** is the gate's `mm_tryon` cookie: `HttpOnly; Secure; SameSite=Strict`, 30 minutes, and `Path=/api/tryon`. A new upload link asked for with a valid cookie belongs to that session too.
- **Status** is unauthenticated. Job IDs are random UUIDs, and it returns only the state and failure code.

### The gate (claim)

- **When a claim is accepted.** The prompt says "any non-failed state". A claim is accepted while the job is queued, rendering, downloading or ready. It is refused (`409 job_not_claimable`) while awaiting upload, because no render was asked for, and once failed or expired, because there is nothing to send.
- **Repeat claims.** The same job claimed again by the same number gets a fresh session and the same lead; the first cookie may have been lost. Claimed by another number, it is refused, so a job ID alone never opens someone else's result. A replayed `Idempotency-Key` returns the first response and sets the cookie again.
- **What a claim writes, in one D1 batch:**
  - the person, whose `contactable` flag is left as it was;
  - the `result_delivery` consent (`gate-v1`);
  - the job's photo consent, copied as `tryon_photo` with the time it was given;
  - the lead (`source = 'tryon'`, `loss_extent` from the stage);
  - the session;
  - the result message: `waiting`, or `queued` if the result is already ready.

  The job is reserved first, so two claims at once cannot both create a lead.

### Answers the prompt leaves open

- **A ceiling reached** answers `503` with the standard error body, code `busy`. A first look that trips the render ceiling is also marked `failed` with `failure_code = busy`, so its status says why.
- **A failed result** answers `422 { "state": "failed", "failure_code": … }`.
- **New error codes:** `busy`, `photo_invalid_file`, `upload_already_received`, `upload_missing`, `session_required` and `job_not_claimable`.
- **Result links.** `/api/result/{token}` serves the image for the link's life: 15 minutes for the browser, one hour for a WhatsApp copy, minted at send time. Its `Cache-Control` is `private, max-age=900`.
- **Rate-limit windows.** Per-address limits count per India clock hour; per-number limits per India day.
- **Result retention** is set by `RESULT_RETENTION_DAYS`: 30 in production, as the prompt and the photo notice say; 3 on staging, whose results only serve tests. Both count against the same R2 allowance. It may not exceed 30.

### Staging and Cloudflare Access

WhatsApp's provider fetches the result image from `/api/result/{token}`. On staging that path must bypass Cloudflare Access (runbook). The token is the guard.

### Flagged for legal: the photo notice

The design's photo notice (`photo-v1`) says "Shared with: Nobody outside Mane Man". Every render sends the photo to AILabTools. The owner chose, on 21 September 2026, to flag this for legal and keep building. A `photo-v2` naming the processor can be added to `src/config/notices.ts` without code changes, and consents record the version each person saw.

## Consequences

- The front end uploads with a plain `fetch(upload_url, { method: "PUT", body })` to the same host; no R2 credentials exist to leak.
- Every R2 write and read is counted by a ceiling, which is what `test/node/free-tier-budget.test.ts` needs to hold the worst case under the free tier.
