# 0254. The client signs off the fit

- Status: accepted. Amended 16 November 2026: the server work ships before the app's screens, so a switch,
  `CLIENT_SIGN_OFF`, holds sign-off off until the app that asks the client ships (below).
- Date: 2026-11-12
- Topic: Field work
- Builds on [0244](0244-the-visit-engine.md), whose plans gain the step

## Context

Nothing recorded that a client accepted a fit (sync audit, section 5). The terms' guarantee runs from the first fit, in
the client's own judgment, and its only record would have been a Care thread. The owner ruled on 12 November 2026
(ruling 6) that a sign-off is required to close a fit: a first fit, a consultation and fit in one visit, and a
replacement. "Client declined to sign", with a reason, is the technician's only way out. The client signs off in
their own app on their own phone, and nowhere else (owner, 12 November 2026).

## Decision

1. **Storage.** `fit_sign_offs` (migration 0210): one row a visit, `state` asked, signed, flagged or declined, the three
   checks (hairline, colour and blend, secure and comfortable), the last flag's text (kept once signed), the decline's
   reason, and when it was asked and signed. Not a new `job_events` kind: ADR 0105 records that a new kind means
   rebuilding a table others reference.
2. **The API.**
   - `POST /api/tech/jobs/{id}/sign-off-request` asks, and can ask again after a flag is fixed.
   - `POST /api/visits/{id}/sign-off` lets the client sign or flag.
   - `POST /api/tech/jobs/{id}/sign-off-declined` takes the reason.
   - The technician's two come through the phone's outbox with its event ID: one sent again, or one a fit has moved
     past (signed in the app meanwhile, say), is answered with the sign-off as it stands, so the close queued behind it
     is never held. A job given to another technician, called off or closed since is refused, as any write is.
3. **The technician app.** A Sign-off step after the after photos and before Outcome, in the first-fit, one-visit and
   replacement plans. It waits for the client, shows a flag with its text, and offers "Client declined to sign", for a
   client who will not or cannot sign in their app. Asking and declining work offline through the outbox; the client's
   answer needs the ask to have reached us. It has Hindi words. Outcome's Done stays disabled, with the
   line "Waiting for sign-off", until the state is signed or declined. The API refuses a done outcome on such a visit
   without one. Ops' close of such a fit by hand, as done, with no sign-off on record, records it as declined, ops' close
   as why.
4. **The client app.** The Home card turns to "Your sign-off": today's after photos, the three checks, "I'm happy with
   the fit" or "Something isn't right" with what and a note. For a first fit it says signing off does not end the
   guarantee.
5. **The console.** The visit's story shows the sign-off, its time, and any flag, including one raised before a
   signature or a decline. A fit that closes done with its sign-off declined opens a Tasks row, "Fit closed without
   sign-off", from the close, carrying any flag; a decline on a fit then left partly done is that visit's own row
   alone.
6. **The guarantee's days.** A sign-off signed or declined records the fit guarantee's days in force then, which a first
   fit's guarantee runs for whatever ops set since (ADR 0256).
7. **The terms.** Signing off is recorded as acceptance at the visit and does not waive the guarantee (ADR 0256).
   Counsel's wording is an open point, not a blocker.

## The switch

The owner split the redesign on 16 November 2026: the server work in one pull request, the client app's screens in
the next. Until the app that asks the client ships, nobody could sign, and every fit would close declined with a
Tasks row. So `CLIENT_SIGN_OFF` (`wrangler.jsonc`, each environment's vars) is off on staging and production, and on
locally, where the tests run. Off, the technician's card has no sign-off step, the sign-off request is refused as
for a service visit, a fit closes done as it did before this decision, and one closed by hand needs none. The
screens' pull request turns it on. The client's live card still counts the step, which only the new screens read.

## Departures

- **No signing on the technician's phone.** The brief has "Sign on this phone", with a one-time code, and a
  `signed_on` of `client_app` or `technician_phone`. The owner ruled on 12 November 2026 that clients sign off on their
  own phone, never the technician's. A client who will not or cannot sign in their app is recorded as declined, with
  why, which gives Care the Tasks row above.
- **The client is not shown the technician's reason for a decline.** It is written for Care.
