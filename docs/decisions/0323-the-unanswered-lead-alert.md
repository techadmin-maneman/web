# 0323. The unanswered-lead alert

- Status: accepted
- Date: 2026-11-25
- Topic: Messages and the CRM

## Context

The owner's launch brief of 25 November 2026 (T16): the console lists new leads with no first reply, and between
9:30 am and 7 pm the person on Care shift is alerted when a lead has waited five minutes. The owner chose a banner in
the console for whoever is on Care shift and a push to their phone, cleared by a reply; the first reply is Care's first
written reply from the console. Asked about a lead who filled in the booking form and never wrote, the owner ruled that
there is nothing to reply to: the alert is for leads who wrote. The reply clock (ADR 0132) already makes a chat past its
reply-by time a task, after the first-reply minutes, an hour by default. The console had no service worker: a desk tool
behind Cloudflare Access, with nothing about a client on a laptop's disk.

## Decision

1. **A waiting lead is someone who wrote to us and waits on Care's first reply**: an open chat from a number we don't
   know, or from someone not yet fitted, whom no Care person has ever written to. The wait counts from their first
   message since the chat last opened. A lead who never wrote is not waiting on a reply; a client already fitted, or
   anyone Care have written to before, is on the reply clock as any chat is.
2. **It waits in Care hours.** Its alert time is when its wait inside Care's times reaches the alert minutes, a new
   figure on Customer Care's times (`care_times.lead_alert`), five by default: a message at 6:58 pm is alerted at
   9:33 am.
3. **Messages lists them as it lists every chat**, and their task stays Unanswered chat, on the reply clock. No other
   task is added.
4. **A banner on every console screen** for a Care person on shift, while a lead is past its alert time, read again
   every half minute as the SOS banner is, in the console's attention colour rather than the SOS banner's red.
5. **A push to the phones of each Care person on shift** who still holds Customer Care · Act, once for each wait, when
   it passes its alert time; never for one that passed it more than an hour before, so a release pages nobody for old
   leads. The push carries nothing, and says only that a lead is waiting. The console gains a service worker that shows
   the push and opens the console when it is tapped: it keeps nothing and answers no request, so nothing about a client
   reaches the device's disk. A manifest lets an iPhone add the console to its home screen, which an iPhone needs
   before it shows a push. A Care person turns the alerts on from the Care team page on each device, three at most; a
   device the push service says is gone is forgotten.

## Consequences

- New tables: `staff_push_subscriptions`, each device's push address and whose it is, and `lead_alert_pushes`, the
  waits already pushed, kept a week by the sweeper.
- The VAPID keys the apps' pushes use sign the console's too.
- Tests: `test/node/policy/care-hours.test.ts`, `test/worker/leads/waiting-leads.test.ts`,
  `test/worker/leads/lead-alert-pushes.test.ts`, `test/dom/ops-lead-banner.test.ts`, `test/dom/ops-phone-alerts.test.ts`.
