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
   (`src/domain/platform/hook-alerts.ts`).
2. **A Razorpay event that throws** raises the urgent `razorpay_event_failing:<event>` from its second try, and keeps
   its backoff; applying it closes the alert (`src/queues/razorpay.ts`).
3. **Checkout failing to load.** The client app reports a Checkout script that errors or times out as
   `checkout_unavailable`; three with no payment captured between raise the urgent `checkout_failing`, and the next
   payment captured closes it. A Content-Security-Policy that blocks the script errors it, so a blocked script is
   reported too, and no separate CSP report endpoint is added.
4. **A visit not begun past its arrival window** is a Tasks task for Operations, "Technician not arrived", due within
   the hour, and an urgent alert from the five-minute cron, `visit_not_begun:<visit>`. A check-in, a close or a cancel
   takes both away; once the day is over, a visit still open is "Visit left open" as before
   (`src/domain/dispatch/not-begun.ts`). The arrival window is ops' own setting (Booking, Start times).
5. **A paced alert space.** A chat that answers 429 is left alone for as long as its Retry-After asks, or a minute, so
   a burst stops at the first refusal; the retell pass tells every first telling the chat missed in one post; and one
   left untold ten minutes goes to the urgent space instead, so a person hears of it.
6. **Foreign errors.** A page's error whose every stack frame ran outside our scripts (`<anonymous>`, an extension's)
   is logged as `client_error_foreign` at info, out of Sentry's errors; one frame of ours makes it ours
   (`src/policy/client-errors.ts`).
7. **A kind of WhatsApp refused too often.** Hourly, each kind whose share refused in the last day passes ops' setting
   (Settings, WhatsApp refused: 20% of at least 5 to begin with) raises `messages_refused:<kind>` for Care; the kind
   back under it closes the alert (`src/domain/messages/refusal-rates.ts`).

## Consequences

- Each of these reaches a person within minutes, by the urgent space where money or a waiting client is at stake.
- Forged posts to a webhook can raise `webhook_refused`; the alert says so, and it closes at the next real delivery.
- The runtime's "code had hung" after Razorpay webhooks in the local simulation (B-011) was not reproduced, by signed
  webhooks or by the app's booking and payment flow on the local stack, and no cause is known; it is left open, and
  is watched for in Sentry on staging, where a cancelled request is an error.
