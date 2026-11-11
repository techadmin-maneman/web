# 0254. The client signs off the fit

- Status: accepted
- Date: 2026-11-12
- Topic: Field work
- Builds on [0244](0244-the-visit-engine.md), whose plans gain the step

## Context

Nothing recorded that a client accepted a fit (sync audit, section 5). The terms' guarantee runs from the first fit, in
the client's own judgment, and its only record would have been a Care thread. The owner ruled on 12 November 2026
(ruling 6) that a sign-off is required to close a fit: a first fit, a consultation and fit in one visit, and a
replacement. "Client declined to sign", with a reason, is the technician's only way out.

## Decision

1. **Storage.** `fit_sign_offs` (migration 0210): one row a visit, `state` asked, signed, flagged or declined, the three
   checks (hairline, colour and blend, secure and comfortable), the flag's text, the decline's reason, when it was asked
   and signed, and where: `client_app` or `technician_phone`. Not a new `job_events` kind: ADR 0105 records that a new
   kind means rebuilding a table others reference.
2. **The API.**
   - `POST /api/tech/jobs/{id}/sign-off-request` asks, and can ask again after a flag is fixed.
   - `POST /api/visits/{id}/sign-off` lets the client sign or flag.
   - `POST /api/tech/jobs/{id}/sign-off-declined` takes the reason.
   - A one-time code lets a client without their phone sign on the technician's.
3. **The technician app.** A Sign-off step after the after photos and before Outcome, in the first-fit, one-visit and
   replacement plans. It waits for the client, shows a flag with its text, and offers "Sign on this phone" and "Client
   declined to sign". It works offline through the outbox and has Hindi words. Outcome's Done stays disabled, with the
   line "Waiting for sign-off", until the state is signed or declined. The API refuses a done outcome on such a visit
   without one.
4. **The client app.** The Home card turns to "Your sign-off": today's after photos, the three checks, "I'm happy with
   the fit" or "Something isn't right" with what and a note. For a first fit it says signing off does not end the
   guarantee.
5. **The console.** The visit's story shows the sign-off, its time and any flag. A declined sign-off opens a Tasks row,
   "Fit closed without sign-off".
6. **The terms.** Signing off is recorded as acceptance at the visit and does not waive the guarantee (ADR 0256).
   Counsel's wording is an open point, not a blocker.
