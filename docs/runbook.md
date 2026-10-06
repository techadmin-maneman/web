# Runbook

Commands run from the repository root. `W` stands for `node node_modules/wrangler/bin/wrangler.js`. Always pass `--env staging` or `--env production`; the top level of each config is local only. `<env>` is `staging` or `production`, and `<t>` is `staging` or `prod`, as resource names have it.

Everything lives in the Cloudflare account `Tech@maneman.in's Account` (`a2e185075b1b8eef3bee24b72f45ace3`), which holds the `maneman.in` zone.

To run SQL against an environment's database: `W d1 execute maneman-<env> --env <env> --remote --command "<sql>"`, where `maneman-<env>` is `maneman-staging` or `maneman-prod`. The SQL below is written for that command.

Five Workers make up each environment: `mm-api` (every `/api/*` route, the database, the queues and the cron), `mm-site` (the public site, `docs/frontend.md`), and the three apps, `mm-app`, `mm-ops` and `mm-tech` (`docs/front-ends.md`). Staging serves all five. Production serves mm-api and a placeholder page from mm-site until the owner's go-ahead.

## When something is wrong

An alert in the alert space names what went wrong with IDs only; [What each alert means](runbook/alerts.md#what-each-alert-means), under [Alerts and the cron](runbook/alerts.md), says where each one leads. Otherwise, start from the symptom:

| Symptom                                                 | Section                                                                                                                                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Nobody can sign in, or messages stop                    | [WhatsApp (Evolution) is down](runbook/tryon-and-whatsapp.md#whatsapp-evolution-is-down), and [The WhatsApp number is banned](runbook/tryon-and-whatsapp.md#the-whatsapp-number-is-banned) |
| Invoices or payments stop reaching Books                | [Books is down](runbook/books.md#books-is-down), [Invoices and Books](runbook/books.md#invoices-and-books)                                                                                 |
| A paid booking is not booked, or a refund failed        | [A booking left unbooked](runbook/books.md#a-booking-left-unbooked), [A refund that failed](runbook/razorpay.md#a-refund-that-failed)                                                      |
| Clients pay and their bookings never confirm            | [Razorpay's webhook is not arriving](runbook/razorpay.md#razorpays-webhook-is-not-arriving)                                                                                                |
| An invoice is still a draft, or Books refuses something | [Invoices and Books](runbook/books.md#invoices-and-books)                                                                                                                                  |
| Leads stop reaching the CRM                             | [Leads and Zoho](runbook/zoho.md)                                                                                                                                                          |
| Try-ons fail                                            | [Try-on and WhatsApp](runbook/tryon-and-whatsapp.md)                                                                                                                                       |
| A technician lost a phone, or their work is stuck on it | [A technician's lost phone](runbook/technician-app.md#a-technicians-lost-phone), [Work stuck on a technician's phone](runbook/technician-app.md#work-stuck-on-a-technicians-phone)         |
| Ops cannot get into the console                         | [Locked out of the ops console](runbook/locked-out.md)                                                                                                                                     |
| Someone says a screen failed, or quotes a Ref           | [Someone says a screen failed](runbook/screen-failed.md)                                                                                                                                   |
| R2 storage is growing, or a usage e-mail came           | [Cloudflare's plan](runbook/cloudflare-plan.md)                                                                                                                                            |
| Every host answers Cloudflare's error 1027              | [Workers daily limit reached (1027)](runbook/cloudflare-plan.md#workers-daily-limit-reached-1027)                                                                                          |
| Data is wrong or gone in D1                             | [Restoring D1](runbook/restoring-d1.md)                                                                                                                                                    |
| The heartbeat or the uptime monitor says mm-api is down | [The outside watchers](runbook/alerts.md#the-outside-watchers), [A cron run cut short](runbook/alerts.md#a-cron-run-cut-short)                                                             |
| A release is misbehaving                                | [Rolling back a Worker version](runbook/rolling-back.md)                                                                                                                                   |
| Personal data may have leaked                           | [A personal data breach](runbook/data-breach.md)                                                                                                                                           |

---

## Provisioning an environment

Setting an environment up, step by step, is [provisioning.md](provisioning.md). The steps this page names are its steps.

## The pages

Each answers one kind of task.

- [The CI runner](runbook/ci-runner.md)
- [Cloudflare's plan](runbook/cloudflare-plan.md)
- [Alerts and the cron](runbook/alerts.md)
- [Leads and Zoho](runbook/zoho.md)
- [Bookings and Books](runbook/books.md)
- [Razorpay](runbook/razorpay.md)
- [Try-on and WhatsApp](runbook/tryon-and-whatsapp.md)
- [The technician app](runbook/technician-app.md)
- [Someone says a screen failed](runbook/screen-failed.md)
- [Locked out of the ops console](runbook/locked-out.md)
- [Erasure within the day](runbook/erasure.md)
- [The service area and the referral log](runbook/service-area.md)
- [A personal data breach](runbook/data-breach.md)
- [The texts file](runbook/texts-file.md)
- [Cities and visit days](runbook/cities.md)
- [Restoring D1](runbook/restoring-d1.md)
- [Rolling back a Worker version](runbook/rolling-back.md)
