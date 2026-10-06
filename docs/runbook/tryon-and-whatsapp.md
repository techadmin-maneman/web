# Try-on and WhatsApp

Part of the [runbook](../runbook.md), whose opening says how its commands are written.

The render consumer is the only caller of AILabTools and the messaging consumer the only caller of WhatsApp (`docs/decisions/0015-render-pipeline.md`), but for login codes: those go straight to the provider once the response has gone (ADR 0030), and only the Worker's log records them, as `login_code_sent`, `login_code_not_sent` with its reason, or `login_code_failed`. D1 records where every job and message stands:

```sql
SELECT state, failure_code, COUNT(*) AS jobs FROM tryon_jobs GROUP BY state, failure_code;
SELECT id, state, endpoint, latency_ms, provider_error_detail FROM tryon_jobs ORDER BY created_at DESC LIMIT 10;
SELECT state, COUNT(*) AS messages FROM outbound_messages GROUP BY state;
SELECT id, attempts, last_error FROM outbound_messages WHERE state = 'failed' ORDER BY created_at DESC LIMIT 10;
```

`provider_error_detail` holds AILabTools' status and message, with the key scrubbed out. `last_error` holds the WhatsApp provider's status and code, never the number.

## AILabTools is down, or refuses the key

Symptoms: jobs fail as `render_failed`. A refused key (401 or 403), a retired endpoint (404) or an empty balance also raise an alert naming the job.

- **Down (5xx, timeouts).** Nothing to do. Each submit is tried three times, and failed calls bill nothing. Customers see "failed" and can try again later.
- **Refused key.** Put a working key in place with `W secret put AILAB_API_KEY --env <env>`. New jobs use it at once.

## Credits are low

The sweeper reads the balance once an hour and alerts once when it is below `AILAB_CREDIT_FLOOR`, not every hour; a top-up that lifts it over the floor closes the alert. Top up in the AILabTools dashboard. At zero, every render fails.

## A ceiling was reached

The alert names the ceiling (`upload`, `render` or `result_read`). Try-ons answer `503 busy` until midnight IST, and the alert fires at most once a day per ceiling. The result-read ceiling also counts a client opening their try-on's photograph or look in the app (ADR 0082), so past it the app's Photos tab shows those two as blank blocks until midnight.

- If the traffic is real, raise the ceiling in `wrangler.jsonc` and deploy. The free-tier budget test refuses any value that could take the account past 80% of a free allowance.
- If the traffic is abuse, leave the ceiling: it is doing its job.

## A billed image was lost

Alert: "its result was billed but never downloaded, and its URL has expired". The download was retried for 24 hours. The customer's job is `failed`, and nothing can recover the image. Check whether the result host (`ailab-outputs.oss-accelerate.aliyuncs.com`) is reachable at all.

## WhatsApp (Evolution) is down

Symptoms: every login code goes through the bridge, so clients and technicians cannot sign in. Two alerts say so: the cron reads the bridge's connection state every five minutes and alerts when two readings in a row find it closed, naming what to check, and login codes alert when three fail to send in an hour. Both close once it works again.

Messages wait out the bridge. While it has no instance by our name (`HTTP 404`), refuses our key (`HTTP 401` or `403`) or has lost its WhatsApp session (`Connection Closed`), a message stays `queued` with the reason in `last_error`, and the sweeper sends it within five minutes of the bridge reading open again. One still unsent a day after it was queued is failed, and one alert a day counts them. A day-before reminder whose visit day has come, or an arrival notice more than ten minutes old, is skipped rather than sent late. An unreachable bridge or an `HTTP 5xx` is tried four times, then the message fails and an alert names it. A message that failed with `delivery unconfirmed` is different: the bridge did not answer in time (20 s for a text, 60 s for an image), and the message may have arrived. It is never retried automatically.

Whoever is signed in stays signed in: a client's or a technician's session lasts 90 days from its last use, and only a new sign-in needs a code. There is no other way in. SMS is off until a DLT-registered provider exists (open point 37), and the fixed code `dev:all` uses is refused anywhere but a laptop. So ask technicians not to sign out while it lasts.

1. Check the bridge. `GET {EVOLUTION_API_URL}/instance/connectionState/{EVOLUTION_INSTANCE_NAME}` with the `apikey` header should say `"state": "open"`.
2. **`HTTP 404`: the bridge has no instance by that name.** List the ones it has: `GET {EVOLUTION_API_URL}/instance/fetchInstances` with the same header. If ours is there under another name, set `EVOLUTION_INSTANCE_NAME` to it. If the list is another app's, `EVOLUTION_API_URL` reaches the wrong bridge: check its host and port (staging's ends in `:8443`). Set either with `W secret put … --env <env>`; a secret change is live at once. **Never create an instance on the shared bridge** to clear the alert: the bridge serves another app too, and an instance made through the wrong URL lands among that app's. If ours is really gone, the owner, who runs the bridge, restores it.
3. **`HTTP 401` or `403`: the bridge refuses the key.** Set `EVOLUTION_API_KEY` to the bridge's key for our instance.
4. **`state close` or `connecting`: the WhatsApp session dropped.** Reconnect it in the bridge (scan the QR code again). If WhatsApp will not take the number back, see the next section.
5. Messages that waited go by themselves once it is open. Replay only those that failed (below).

**`MESSAGING_ENABLED`.** Set to `"false"` in `wrangler.jsonc` and deployed, it stops every message except login codes:

- the try-on's WhatsApp copy, which the gate then stops promising;
- every message about a visit: the booking confirmation, the payment receipt, the reminder the day before, a move, a cancel, the technician's arrival and a no-show ruling. The cron stops queuing reminders at all;
- the referral messages, the waitlist's confirmation and a pincode's launch.

A message queued while it is off is marked `skipped` rather than held, so switching it back on sends none of them. The technician's arrival message is a no-show's evidence (ADR 0047): with messaging off, a no-show has no delivery receipt to show. Login codes still go, as nobody could sign in otherwise; only stopping the bridge stops them. Production has messaging off today.

## The WhatsApp number is banned

The bridge drives an ordinary WhatsApp account, and WhatsApp can ban a number for sending automatically (ADR 0016). The bridge's connection then closes and will not open again with that number: the alerts are the ones above, and scanning the QR code fails, or WhatsApp on that phone says the number is banned.

1. Nobody who is signed out can sign in (above). Tell ops, and ask technicians to stay signed in.
2. Connect the bridge's instance to another WhatsApp number, by its QR code. The instance keeps its name and key, so the Worker's secrets stay as they are. If a new instance is made instead, set `EVOLUTION_INSTANCE_NAME`, and `EVOLUTION_API_KEY` if it has its own, with `W secret put` (a secret change is live at once), and point its receipts' webhook at us (step 12).
3. Clients now hear from another number. The number the site and the apps ask clients to write to is `WHATSAPP_NUMBER` in `packages/web-kit/whatsapp.ts`; if that number is the banned one, change it and release the site and the apps.
4. Replay the messages that failed (below).

The lasting answers are a number of Mane Man's own (open point 38) and SMS (open point 37).

## Replaying a failed message

One message: **Send again** on its alert, under Tasks' Needs a hand. Many, after an outage:

```sql
UPDATE outbound_messages
SET state = 'queued', attempts = 0, sending_at = NULL,
  queued_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes')
WHERE state = 'failed' AND created_at > '<since, e.g. 2026-09-21>'
  AND last_error NOT LIKE '%delivery unconfirmed%';
```

The sweeper sends them within five minutes, once the bridge reads open. `queued_at` is set ten minutes back so the next run takes them; set it further back than a day and the sweeper fails them again unsent. Every attempt mints a fresh link, so an old failure is not a problem, as long as the result has not been deleted. A reminder whose visit day has come, or an arrival notice past its ten minutes, is skipped rather than sent. Replay a `delivery unconfirmed` message only once you know it did not arrive; otherwise the person gets it twice.

## Stuck jobs

The sweeper re-enqueues renders whose queue message was lost, and fails a submit that died part-way after 10 minutes, because submitting again could bill twice. Nothing to do by hand.

---
