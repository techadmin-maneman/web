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
   checks (hairline, colour and blend, secure and comfortable), the last flag's text (kept once signed), the decline's
   reason, when it was asked and signed, and where: `client_app` or `technician_phone`. Not a new `job_events` kind: ADR 0105 records that a new
   kind means rebuilding a table others reference.
2. **The API.**
   - `POST /api/tech/jobs/{id}/sign-off-request` asks, and can ask again after a flag is fixed.
   - `POST /api/visits/{id}/sign-off` lets the client sign or flag.
   - `POST /api/tech/jobs/{id}/sign-off-declined` takes the reason.
   - `POST /api/tech/jobs/{id}/sign-off` lets a client without their phone sign or flag on the technician's, asking
     first where the phone had not.
   - The technician's three come through the phone's outbox with its event ID: one sent again, or one a fit has moved
     past (signed in the app meanwhile, say), is answered with the sign-off as it stands, so the close queued behind it
     is never held. A job given to another technician, called off or closed since is refused, as any write is.
3. **The technician app.** A Sign-off step after the after photos and before Outcome, in the first-fit, one-visit and
   replacement plans. It waits for the client, shows a flag with its text, and offers "Sign on this phone" and "Client
   declined to sign". Asking, signing on the phone and declining all work offline through the outbox; the client's answer
   in their own app needs the ask to have reached us. It has Hindi words. Outcome's Done stays disabled, with the
   line "Waiting for sign-off", until the state is signed or declined. The API refuses a done outcome on such a visit
   without one. Ops' close of such a fit by hand, as done, with no sign-off on record, records it as declined, ops' close
   as why.
4. **The client app.** The Home card turns to "Your sign-off": today's after photos, the three checks, "I'm happy with
   the fit" or "Something isn't right" with what and a note. For a first fit it says signing off does not end the
   guarantee.
5. **The console.** The visit's story shows the sign-off, its time and where, and any flag; a signature on the
   technician's phone is marked "Worth a call to confirm". A fit that closes done with its sign-off declined opens a
   Tasks row, "Fit closed without sign-off", from the close; a decline on a fit then left partly done is that visit's
   own row alone. A fit that closes done signed on the technician's phone opens one too, "Fit signed on the
   technician's phone", carrying any flag the client raised first, until Care have confirmed it with the client.
6. **The guarantee's days.** A sign-off signed or declined records the fit guarantee's days in force then, which a first
   fit's guarantee runs for whatever ops set since (ADR 0256).
7. **The terms.** Signing off is recorded as acceptance at the visit and does not waive the guarantee (ADR 0256).
   Counsel's wording is an open point, not a blocker.

## Departures

- **No one-time code for signing on the technician's phone.** The brief asks for one. A code the API gives to the
  technician's own phone proves nothing about the client, since whoever holds the phone holds the code, and it would
  stop the client signing there with no signal, which the brief also asks for. So the phone sends the client's answer
  through its outbox like any other write, and the control is that it is seen: every such signature gives Care a
  Tasks row to confirm it with the client, and the client is told of it in their own app, with a way to say it was not
  them (ADR 0255).
- **The client is not shown the technician's reason for a decline.** It is written for Care.
