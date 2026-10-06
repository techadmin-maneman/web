# 0011. The lead API

- Status: accepted. Amended by ADR 0067: Turnstile refusing our own secret, or failing itself, answers `503 unavailable`, and an outage is logged and alerted. Amended 28 September 2026: `POST /api/lead` and `GET /api/cities` are removed on the owner's ruling (`docs/open-points.md`, item 107). What this decided for errors, Turnstile, idempotency and the daily limits stands in the site's booking routes that replaced them (ADR 0051, `src/http/public-form.ts`).
- Date: 2026-09-21
- Topic: Messages and the CRM

## Context

The prompt fixes `GET /api/cities` and `POST /api/lead`: body `{ name, mobile, city, first_choice_window, loss_extent, consent }`, with Turnstile, validation, idempotency and rate limits. Answering `201 { lead_id, served, proposed_visit_date?, window_label? }`. Some details were left open.

## Decisions

**Body.** The prompt's fields, plus:

- `turnstile_token`, required: the widget's token has to reach the server somehow.
- `attribution`, optional: `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `gclid`, `fbclid`, `referrer`, `landing_path`. The leads table has these columns and nothing else supplies them.

Any other field is rejected.

**Mobile numbers.** The design collects ten digits after a fixed +91. The API also accepts the number with `+91` or `0` in front, and with spaces or hyphens. It must start with 6 to 9. It is stored as E.164, `+91XXXXXXXXXX`. The same number is the same person: a second submission updates their name, adds a consent and a lead, and keeps their ID.

**Errors.** Validation failures return `400 invalid_request` with `fields`: the names of the failing fields, never their values. A body that is not JSON gets the same answer, not a 500.

**Turnstile fails closed.** A rejected token gives `403 turnstile_failed`. If Turnstile cannot be reached, the answer is `503 unavailable`; an unverified submission is never saved.

**Rate limits**, in India calendar days:

- 5 leads a day per mobile number, as the prompt sets.
- **Added:** 20 a day per IP address. A flood that gets past Turnstile would otherwise spend D1's 100,000 free writes a day (0009).
- Counter keys are salted hashes, so D1 holds neither the raw number nor the raw address.

**Idempotency** (`Idempotency-Key` header, optional):

- The key is reserved before any work, so two simultaneous retries cannot both create a lead.
- Only a success is stored and replayed. A failure releases the key, so a retry with a fresh Turnstile token can succeed.
- The same key with a different body gives `422 idempotency_key_reused`. The same key while the first request is still running gives `409 idempotency_in_progress`.
- Records expire after 24 hours; the sweeper deletes them.

**Proposed visit date.** The first India date at least `VISIT_LEAD_DAYS` days after submission that matches the window's day type and is not in `visit_blackouts`. The search runs 60 days ahead. If every day is blacked out, the response leaves the date out and the Worker logs an error. Ops still get the lead.

**Durability.** The person, consent, lead and an event are written in one D1 batch, which D1 applies as a transaction. The CRM hears of the lead from the `crm-sync` queue. If the queue refuses the message (for example, at the free-tier limit), the request still returns 201, and the sweeper enqueues the lead two minutes later.

**New secret: `IP_HASH_SALT`.** The prompt asks for salted IP hashes but does not list a salt secret. It must be at least 32 characters, and it also salts the mobile hashes in rate-limit keys.

**Startup guard extended** (0003). At module load the Worker now also refuses to run when:

- `TURNSTILE_SECRET` or `IP_HASH_SALT` is missing in any environment;
- `ALERT_WEBHOOK_URL` is missing in staging or production;
- any Zoho secret is missing while `CRM_PROVIDER` is `zoho`;
- production holds one of Cloudflare's Turnstile test secrets;
- a limit is not a whole number.

Cloudflare evaluates module load with the Worker's secrets during upload. A probe on 21 September 2026 showed this: a version that throws unless a secret is present was accepted when the secret existed. So a misconfigured deploy is rejected at upload, before it takes any traffic.

## Staging accepts Cloudflare's dummy Turnstile token

Added on 21 September 2026, for the M2 staging proof.

No page on staging renders the Turnstile widget yet (that is front-end work), so nothing can produce a real staging token. With `TURNSTILE_ACCEPT_TEST_TOKEN = "true"`, the Worker checks Cloudflare's published dummy token, `XXXX.DUMMY.TOKEN.XXXX`, against Cloudflare's always-pass test secret; every other token is still checked against the real widget secret.

- On in local and staging, off in production. The startup guard refuses to start production with it on.
- Staging is behind Cloudflare Access, so only the founders and CI can reach it anyway.
- It lets the `staging-lead` workflow create test leads to check the Zoho path, now and after later changes.
