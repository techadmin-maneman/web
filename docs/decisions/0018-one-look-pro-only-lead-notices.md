# 0018. One look per visitor, Pro only, and new-lead notices

- Status: accepted
- Date: 2026-09-21

## Context

After M3's staging proof, the owner decided three things on 21 September 2026. Each changes something the prompt or the design specified.

## Decisions

### One look per visitor

The design offers "one photograph, six looks", and the prompt a "try another look" with no second gate. The owner decided instead that a visitor gets one look, even after the gate.

- `POST /api/tryon/generate` renders the look for an uploaded photo once. The same look asked for again returns that job; any other look answers `403 look_limit_reached`.
- When the render is queued, the browser gets an `mm_look` cookie naming the job, for 30 days: `HttpOnly; Secure; SameSite=Strict; Path=/api/tryon`. `POST /api/tryon/upload-url` refuses a browser whose named job has not failed (`403 look_limit_reached`).
- A render that failed doesn't count, so a visitor whose photo showed no face can try another.

The limit is best-effort. Without verifying the phone number before the render, clearing cookies or changing browsers gets round it, and an address limit can't be tightened far: Indian mobile networks put many people behind one address. What holds spend is unchanged: the per-address hourly limits and the global daily render ceiling (docs/decisions/0015).

The M3 check "a second look releases without a second gate or a second lead" is superseded. The `parent_job_id` column and the `try_on_additional_look` event are no longer written; the column stays, because migrations are forward-only.

### Pro only

The prompt sends a job whose hair colour the browser could not read to Premium, with `color=original` (`UNKNOWN_COLOR_ROUTE = premium_original`). On staging, Premium:

- changed the face, as the harness had found (API notes, 7.7);
- cost 15 credits against Pro's 10;
- once took 6½ minutes.

The owner chose Pro only: `UNKNOWN_COLOR_ROUTE` is `pro_black` in every environment. An unreadable colour is rendered black on Pro. The Premium path stays in the code, and switching back is a config change.

### A chat notice for each new lead

New leads were announced only through Zoho's assignment e-mail. The owner asked for a Google Chat message for each, without personal data.

- When a lead first reaches the CRM, the crm-sync consumer posts one line, for example "New booking: Gurgaon, weekday morning, proposed Wed 23 Sep. Lead 0b9f1a52."
- A waitlist line names the city. A try-on line says whether the person may be chased.
- There is never a name or number, and the text is scrubbed of both as a last defence.
- The line goes to `LEAD_WEBHOOK_URL` if set, otherwise to the alert space (`ALERT_WEBHOOK_URL`).
- A lead that cannot reach the CRM posts no notice; its failure alerts instead (docs/decisions/0012).

## Consequences

- **The front end.** It offers one look, and on `look_limit_reached` explains that each visitor gets one.
- **Chat traffic.** On a busy day the alert space fills with lead notices. `LEAD_WEBHOOK_URL` can point them at a space of their own.
