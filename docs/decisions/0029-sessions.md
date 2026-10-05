# 0029. Sessions for the client app

- Status: accepted
- Date: 2026-09-22

## Context

The Phase 2 backend prompt asks for the client app's routes to sit "behind the session cookie. The cookie is host-only, `HttpOnly`, `Secure`, `SameSite=Lax`, with a 90-day sliding expiry that is revocable." The technician app will need sessions too, bound to a device that ops can revoke (P2-M4).

## Decision

**A session is a random token in a cookie, stored only as its hash.** A login (ADR 0030) opens a session:

- **The token:** 32 random bytes, base64url, in the `mm_app` cookie.
- **The row:** `sessions` (migration 0007) keeps the token's SHA-256 as the session's ID, never the token itself. A copy of the database therefore opens no session. The token has 256 bits of entropy, so a plain hash is enough and no pepper is needed.
- **The cookie:** `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=90 days`, with no `Domain`. It stays on the client app's own host (ADR 0026), so no other `*.maneman.in` site receives it.

**90 days from last use.** Each request with a live session moves its expiry on and sets the cookie again, at most once an hour, so a busy app does not write on every request. A session unused for 90 days ends.

**Revocable.** Logging out sets `revoked_at` and clears the cookie. Erasing a person (ADR 0019) revokes every session they have. The app's profile lists the client's live sessions by device, from `device_label` ("Chrome on Android"), which is taken from the User-Agent at login, and signs any of them out, or every one but this (`/api/sessions`, `src/routes/client/sessions.ts`). Each is named there by the first 16 hex of its stored hash, which opens nothing. The full User-Agent is never kept. Ops' confirmation of a number change signs out every session but the one that asked for it, so a phone that went with the old number is signed in no longer.

**One table for both apps.** `sessions.subject_kind` is `client` or `technician`, and `subject_id` names the person or the technician. P2-M4 adds the technician's device binding beside it.

**Kept briefly after they end.** The sweeper deletes a session 30 days after it expires or is revoked.

## Consequences

- **Writes need the page's own Origin.** `SameSite=Lax` alone would let another `*.maneman.in` page post with the cookie, which is why the client surface refuses cross-origin writes (ADR 0026).
- **An installed iOS web app has its own cookie store,** so a client who adds the app to the home screen logs in once more there (the plan's issues list).
- **Tests** (`test/worker/client-auth.test.ts`) cover:
  - the cookie's exact attributes, and only the hash being stored;
  - the hourly slide, and the end after 90 days;
  - logout, erasure, and a made-up cookie;
  - the device label (`test/node/device-label.test.ts`);
  - the list, and signing one session or every other out (`test/worker/client-sessions.test.ts`);
  - a confirmed number change signing out the old phone (`test/worker/client-profile.test.ts`).
