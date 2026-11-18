# 0277. Alerts that come sooner

- Status: accepted, on the owner's approval of the QA run's fix plan, 18 November 2026
- Date: 2026-11-18
- Topic: Platform
- Amends [0067](0067-alerts-and-silent-failures.md)

## Context

The QA run of 18 November found failures that reached ops late, or not at all:

- Razorpay Checkout failing to load in the client app failed every payment, and told nobody (C-002).
- A technician who did not turn up raised nothing until the day was over (B-005).
- A provider's webhook failing its signature check was first noticed 15 to 75 minutes later, and only if a client paid
  (C-003).
- A Razorpay event that kept failing reached ops after about four hours, through the dead letters (C-016).
- A burst of alerts hit the chat webhook's rate limit, and each then waited five minutes or more to be told again
  (M-012).
- Errors thrown by code a browser injects into our pages reached Sentry as our own (M-013).
- A kind of WhatsApp Meta refused for most clients raised one task per message, but nothing about the kind (M-010).

## Decision

1. **A webhook refused at our door** three times in a row, with none taken between, raises the urgent
   `webhook_refused:<hook>` for Razorpay, MSG91 and Evolution alike; the next delivery taken closes it
   (`src/domain/platform/hook-alerts.ts`). Told once, its refusals are not counted again for a day, open or closed,
   so posts anyone can forge page once a day at most, and stray ones between real deliveries never stop a real
   mismatch from being told.
2. **A Razorpay event that throws** counts each failure toward the urgent `razorpay_event_failing:<event>`, raised at
   its second, and keeps its backoff; applying it closes the alert (`src/queues/razorpay.ts`). A refund that came
   before its payment uses a try without failing, so one failure after it tells nobody. With D1 down, an alert that
   waits for several sightings is not told on its first, since its count cannot be kept.
3. **Checkout failing to load.** The client app reports a Checkout script that errors or times out, or that loaded
   with no Razorpay in it, as `checkout_unavailable`. Each signed-in client counts once an hour, and three within a
   quarter of an hour raise the urgent `checkout_failing`; a report from a page not signed in counts for nothing, so
   nobody outside raises it. The next payment made through Checkout, on the order of a hold booked through it,
   closes it; a payment link's does not, a link sent for a hold included, whose order the hold takes once paid. The client app's Content-Security-Policy now reports what it refuses to mm-api
   (`/api/csp-reports`, as the site's does), so a Checkout frame or script blocked from a new host is logged; the
   browser posts it itself, so the route takes it with no Origin.
4. **A visit not begun past its arrival window** is a Tasks task for Operations, "Technician not arrived", due within
   the hour, which opens the visit on the board, and an urgent alert from the five-minute cron,
   `visit_not_begun:<visit>`, except for a script's test record. A check-in, a close or a cancel
   takes both away; once the day is over, a visit still open is "Visit left open" as before
   (`src/domain/dispatch/not-begun.ts`). The arrival window is ops' own setting (Booking, Start times).
5. **A paced alert space.** A chat that answers 429 is left alone for as long as its Retry-After asks, or a minute, so
   a burst stops at the first refusal; the retell pass tells every first telling the chat missed in one post; and one
   left untold ten minutes goes to the urgent space instead, cut to fit a phone push, so a person hears of it. A lead
   notice, which is never told again, is always tried.
6. **Foreign errors.** A page's error whose every stack frame ran outside our scripts (`<anonymous>`, an extension's)
   is logged as `client_error_foreign` at info, out of Sentry's errors; one frame of ours makes it ours, a frame that
   names no origin (the site's Worker's) is ours, and Checkout not loading is always ours
   (`src/policy/client-errors.ts`).
7. **A kind of WhatsApp refused too often.** Hourly, each kind whose share refused in the last day passes ops' setting
   (Settings, WhatsApp refused: 20% of at least 5 to begin with) raises `messages_refused:<kind>` for Care; the kind
   back under it closes the alert (`src/domain/messages/refusal-rates.ts`). What Care do not chase, the marketing texts
   above all, is not counted.

## Consequences

- Each of these reaches a person within minutes, by the urgent space where money or a waiting client is at stake.
- Forged posts to a webhook can raise `webhook_refused`; the alert says so, and it closes at the next real delivery.
- The runtime's "code had hung" after Razorpay webhooks in the local simulation (B-011) was not reproduced, by signed
  webhooks or by the app's booking and payment flow on the local stack, and no cause is known; it is left open, and
  is watched for in Sentry on staging, where a cancelled request is an error.
