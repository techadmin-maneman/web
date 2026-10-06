# Someone says a screen failed

Part of the [runbook](../runbook.md), whose opening says how its commands are written.

The console and the technician app show a **Ref** under a page that did not load, and under a technician's step the API refused: the first eight characters of the call's request ID, and "Copy" copies the whole ID. Every line mm-api logged of that call carries it as `request_id`. In Workers Logs (the `mm-api` Worker → Logs), filter on `request_id` starting with the Ref, or equal to the copied ID. A change in the console that failed shows no Ref: every console call is in `audit_log` under the person, with its `request_id`.

```sql
SELECT at, action, request_id, detail FROM audit_log WHERE actor = '<their e-mail>' ORDER BY at DESC LIMIT 20;
```

The client app, the console and the technician app also report their own errors, each as one `client_error` line: `app` (client, ops or tech), `kind` (`error`, `unhandled_rejection`, `render`, or `outbox_gave_up` for a step the technician app stopped sending because the API refused it), `message`, `path`, and the outbox's `step`, `code` and `refused_request_id`. A page sends ten at most, and an address twenty an hour. A run of them after a release points at that release: tell the developers.

---
