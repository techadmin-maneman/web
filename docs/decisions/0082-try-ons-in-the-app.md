# 0082. A client's try-on in the app

- Status: accepted, on the owner's ruling of 27 September 2026 (ADR 0025, item 63)
- Date: 2026-09-27
- Follows [0014](0014-try-on-api.md), [0018](0018-one-look-pro-only-lead-notices.md), [0019](0019-erasure.md), [0039](0039-phase-2-budget.md) and [0043](0043-client-app.md)

## Context

The owner tried the client app on staging and asked, on 27 September 2026, why the photograph a client uploads for the try-on, and the look made from it, are not shown to them. Asked, the owner confirmed they should show in the app, and do not. The Photos tab listed only the photographs FSM holds of each visit, so a client who made a try-on on the site before their consultation read "Your photographs start at your first fit."

What the try-on keeps, and for how long, was settled before and is not changed here:

- **The photograph** is deleted an hour after the last look asked of it, once no look of it is still being made (`PHOTO_RETENTION_MS`, `src/config/tryon.ts`; the sweeper). The bucket's 30-day rule is the backstop.
- **The look** is deleted `RESULT_RETENTION_DAYS` after it is made: 14 in production (ADR 0039), 3 on staging.
- **An erasure** deletes both at once (ADR 0019).

The notices promise deletion "after thirty days"; the privacy page says "within thirty days, usually within the hour", and that the simulation "is kept for fourteen days".

A try-on becomes a person's when the site's gate is passed with a mobile number (ADR 0014): the claim finds, or makes, the `people` row with that number. The app's login finds the person by the same number, and `people.mobile_e164` is unique, so the try-on and the app account are one row. A client who later changes their number in the app keeps their try-ons, since the change moves the row's number. A try-on claimed with a number other than the one the client logs in with belongs to another row, and is not theirs in the app.

## Decision

**`GET /api/photos` answers the client's try-ons beside their visits** (`try_ons`), so the tab is still one request. Each is a try-on the gate claimed with the client's number whose photograph or look is still held, newest first, with:

- `made_on`, India's date the look was asked for;
- `photo`, a link to the photograph they uploaded while it is held, and `kept_until`, an hour after the last look asked of it;
- `look`, a link to the look once it is made and until it expires, and `kept_until`, when it expires.

**What is left out, and why:**

- **A failed render.** No look came of it, the site asks for another photograph (ADR 0018), and the try-on made from that one is listed instead. Its photograph goes within the hour in any case.
- **Nothing of a render still being made.** It shows its photograph alone; the look follows when it is ready.
- **The photograph, on a second look of it.** Only jobs made before ADR 0018 can be one. The photograph is shown once, beside its first look.
- **A try-on with nothing left.** Once its photograph and its look are both deleted, by time or by erasure, it drops out.

**Every image goes through the client's session, as a visit's photograph does** (`GET /api/photos/file/{token}`). The route is `GET /api/photos/try-on/{photo|look}/{token}`:

- the token is signed with `RESULT_SIGNING_KEY` for the image's own purpose, `tryon_photo` or `tryon_look`;
- it names the job, never an R2 key, and lasts 15 minutes;
- it opens only for the session whose person the job is, and only while the image is held;
- the answer is `Cache-Control: private, max-age=900`, and names the file with its type's own extension.

Each read takes from the day's result-read ceiling, as the site's result link does. So every read of the try-on's buckets is still counted (ADR 0014), and the free-tier budget holds as written (ADR 0009, ADR 0039).

**Why the client session, and not the site's own doors.** The gate's session lasts 30 minutes and the look cookie belongs to one browser, so neither reaches the phone a client signs in on days later. The client session is what the app already proves for their visit photographs.

**The app draws each try-on as board D1 draws a visit.** Its date and "Your try-on" head the images: two, the photograph beside the look, where a visit has five. A line beneath says how long each is kept. An image already deleted stays a blank block, as an angle not taken does, and a tap on either opens the photo sheet (board D3) to view or download it. No board draws any of this, so every word is a placeholder (`apps/app/src/content.ts`), and the departure is recorded in ADR 0025, item 63, and `docs/fidelity-method.md`.

**Where it sits.** The try-ons stand above the visits. A client with no visit photographs yet sees the try-on and then D3's two lines, without its glyph. A client with neither sees board D3, and a fitted client without a try-on sees board D1, both unchanged.

**The retention and erasure rules do not change.**

## Consequences

- **The photograph is in the app for an hour at most.** A client who books after a try-on usually signs in later than that, and then sees the look alone, with "Your photograph was deleted within the hour." Keeping the photograph as long as its look would keep the notices true, which promise thirty days. But it would cost R2 room ADR 0039's budget does not have: at production's upload ceiling, 80 photographs a day of up to 5 MB each, held 14 days, is up to 5.6 GB. The owner decides (`docs/open-points.md`, item 146).
- **Counsel should confirm the notices cover this** (open point 145):
  - the photo notice says the photograph is "Used for: Generating your simulation. Nothing else.";
  - the privacy page says a number given at the gate is used "to send you the result on WhatsApp and for nothing else".

  Showing a client their own photograph and look, behind their own login, gives them what we hold, which the data export already does; but the number now also joins the try-on to their app account. Until counsel says, staging shows the try-on. If a notice must change, it is a new version in `src/config/notices.ts`, and consents record which one each person saw.

- **The data export** (`GET /api/me/export`) already lists the client's try-ons; it is unchanged.
- **A look read in the app counts against the site's result-read ceiling.** Past it, the app's try-on images answer `busy` as the site's links do, until midnight in India, and ops are told once.
- **Tests:** `test/worker/client-try-ons.test.ts`; `e2e/app/try-on.e2e.ts`, against a claimed try-on the global setup seeds (`e2e/app/try-on.ts`); every client-app fidelity pair is unchanged.
