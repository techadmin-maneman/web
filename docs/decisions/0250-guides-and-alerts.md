# 0250. Guides and alerts

- Status: accepted
- Date: 2026-11-11
- Topic: Field work
- Builds on [0244](0244-the-visit-engine.md), whose visit engine the guides read, and [0249](0249-schedule-kit-and-me.md),
  whose preview links to them

## Context

PR 10 of the technician redesign (`docs/technician-redesign/PLAN.md`) covers Guides and Alerts. The brief
(`docs/prompts/tech-redesign.md`, "Me", "Alerts") asks for a library of how each visit is done, and for an inbox of
alerts with four kinds the technician turns on or off: time to leave, the day ahead, job changes and running over, each
also a push that looks like the phone's own, with Navigate and Open job. Backend gap 4 of the plan is the push: VAPID
keys as secrets, the technician's subscriptions and per-kind settings.

## Decision

1. **Guides**, from Me and from a later job's preview ("How this visit is done"), list the four kinds of visit. Each
   guide is the visit engine's screens for that kind, in order, as a visit would have them, and a step of tasks lists its
   tasks from the job sheet. Each task opens alone, read-only: its reference, the numbered instructions and what to watch
   for, drawn by the one part the checklist step draws them with. Everything comes from what the phone already holds, so
   Guides open with no signal.
2. **The inbox** (`GET /api/tech/alerts`) holds the last seven days' alerts, newest first, and is marked read when
   opened. Today's head carries a bell with how many are new. Tapping an alert opens its job, or the day ahead's day. A
   job no longer the technician's is told without its client. The client's name and Navigate come only while the job is
   theirs and unlocked, by the rule the job list follows.
3. **What writes an alert.** The cron, every five minutes, writes time to leave for a job not begun once its leave-by is
   ten minutes or less away, and running over once a visit under way will end after the time it must finish by to reach
   the next on time. That is the rule Today's line already shows, now one rule in `src/policy/tech-alerts.ts` for both.
   At 8 pm in India it writes the next day's jobs. A job in the coming week moved, called off, or given to another
   technician writes its alert by a trigger on `appointments` (migration 0209), whatever made the change. Each alert is
   written once, by its own key, and none is written for a kind turned off.
4. **A push carries nothing.** The cron pushes each new alert to every phone signed in as its technician that allowed
   notifications, signed with our VAPID key (RFC 8292) and with no payload. The service worker then reads the inbox with
   the phone's own session and shows the newest alert. Nothing about a client passes through Apple's or Google's push
   services, and no encryption library is needed. The lock screen names no client: "Leave in 10 min · 11:30 am service
   visit · Sector 65". A phone signed out or revoked takes no pushes. A subscription the push service has forgotten is
   deleted. A push goes only to a browser push service's host, never an address a phone made up.
5. **The keys** are two Worker secrets, `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`, set together. Where none is set, as
   locally, each push is logged and not sent, and the phone does not ask for notifications.
6. **Three new tables** (migration 0209): `tech_alerts`, `push_subscriptions` (one a phone) and `tech_alert_kinds_off`.

## Departures

- **The settings** sit on the Alerts screen under "Send me", as the prototype has them, and Me's row opens it.
- **The bell's count** is square, the brand's edge, not the prototype's round badge.
- **The lock screen's words** leave out the client's name that the inbox shows (item 4).
- **Time to leave** is said in the minutes left when the cron found it, five to ten, since the cron runs every five
  minutes.
