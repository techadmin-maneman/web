# 0024. The browser's own look: an optional gate, and a look shown again

- Status: accepted, on the owner's review of 22 September 2026. Amended 28 September 2026: the refusal answers 401, as `session_required` does everywhere (`docs/open-points.md`, item 105).
- Date: 2026-09-22

## Context

Two things the owner found on staging:

- **The gate's copy says the number is optional**, but the site demanded it. The approved notice (`gate-v1`) reads "The result opens on the next screen either way. The number is so we can send you a copy." Yet v2's form required both fields, and the API showed a result only to the session that `POST /api/tryon/claim` opens.
- **"You have had your look" showed nothing.** A visitor who came back and chose a new photograph got the error screen, not the look they already had. The page could not ask for it: the `mm_look` cookie is `HttpOnly`, and the result needed the gate's session, which lasts thirty minutes.

Until now the API has held to one rule: a job ID alone never opens someone's result (ADR 0014, and `tryon-claim.ts`).

## Decision

**The `mm_look` cookie is signed.** Its value used to be the bare job ID, which anyone who knew the ID could send. It is now a token signed with `RESULT_SIGNING_KEY` for the purpose `look`, expiring with the cookie after thirty days (`src/http/session.ts`). A made-up, altered or stale cookie counts as no cookie. Cookies set before this change were never signed, so they no longer count; they existed only on staging, since production has served no try-on.

**The browser that made the look may see it.** `GET /api/tryon/result/:job_id` now answers either the gate's session, as before, or the browser whose signed `mm_look` names the job. Anyone else gets `401 session_required`, whether or not the job exists, so a job ID alone still reveals nothing. (It answered 403 until 28 September 2026, when the owner ruled that each error code answers with one status everywhere.)

**`GET /api/tryon/look`** returns the look the browser's signed cookie names: its job ID, state, stage and preset. It answers `404` without a genuine cookie, and once the job has expired, which is when its photograph and result are deleted.

**The site follows** (ADR 0022, 32 and 33):

- **At the gate**, both fields left empty open the result. Either field filled in needs both, and then the claim saves the lead and sends the WhatsApp copy as before.
- **A browser refused a second photograph** (`look_limit_reached`) is shown its first look again: the result alone, with the look's label. The error screen appears only when that look is gone.

## Consequences

- **Fewer leads.** A visitor who leaves the number out creates no lead and gets no WhatsApp copy. The gate is now an invitation, as its copy always said.
- **Anyone using the same browser within thirty days can see its look.** That is the same reach as the one-look limit itself. The privacy text says so.
- **No database change.** The contract adds one route and widens one route's access. `docs/openapi.json`, `docs/api.md` and the site's generated types are regenerated.
- **Tests.** The worker tests cover the new access, and refuse a bare, altered, stale or other job's cookie. The browser tests run both paths against the local API.
