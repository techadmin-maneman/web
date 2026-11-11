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

1. **Guides**, from Me, from a job ("How this visit is done", beside Client history) and from a later job's preview,
   list the four kinds of visit. Each guide is the visit engine's screens for that kind, in order, as a visit would
   have them, and a step of tasks lists the checklist ops set for that kind in the console (`GET /api/tech/checklists`),
   so the guide asks for what the visit's own checklist step asks for. The phone keeps the lists as last read, so Guides
   open with no signal; the committed lists stand until the first read. Each task opens alone, read-only: its
   reference, the numbered instructions and what to watch for, drawn by the one part the checklist step draws them with.
   A guide goes back to where it was opened from.
2. **The inbox** (`GET /api/tech/alerts`) holds the last seven days' alerts, newest first, and is marked read when
   opened. Today's head carries a bell with how many are new. Tapping an alert opens its job, or the day ahead's day. A
   job no longer the technician's is told without its client. The client's name and Navigate come only while the job is
   theirs and unlocked, by the rule the job list follows. A job on another day says which day.
3. **What writes an alert.** The cron, every five minutes, writes time to leave for a job not yet reached once its
   leave-by is within the notice ops set (`leave_notice_min`, 10 minutes until changed), once for each time the job
   starts, so a job moved is told again; and running over once a visit under way will end after the time it must finish
   by to reach the next on time, the rule Today's line already shows, now one rule in `src/policy/tech-alerts.ts` for
   both. In the hour ops set (`day_ahead_hour`, 8 pm until changed) it writes the next day's jobs, and deletes alerts
   older than the inbox shows. A job in the coming week moved, called off, or given to another technician writes its
   alert by a trigger on `appointments` (migration 0209), whatever made the change; a job called off or given away after
   its time, as its technician waits at the door, is told too. Each alert is written once, by its own key, and none is
   written for a kind turned off.
4. **A push carries nothing.** The cron pushes each alert not yet read to every phone signed in as its technician that
   allowed notifications, signed with our VAPID key (RFC 8292) and with no payload; a technician switched off is pushed
   nothing. The service worker then reads the inbox with the phone's own session and shows each alert it has not shown
   before, a notification each, of those its push could still bring: written within the hour, as the cron pushes an
   alert up to 30 minutes after it is written and the push lives 30 minutes more. Older ones, whose push the phone
   missed, wait in the inbox. Nothing about a client passes through Apple's or Google's push services, and no
   encryption library is needed. The lock screen names no client (owner, 11 November 2026): "Leave in 7 min · 11:30 am
   service visit · Sector 65", its minutes counted as it is shown. A phone signed out or revoked takes no pushes. A
   subscription the push service has forgotten is deleted. A push goes only to a browser push service's host, never an
   address a phone made up, and follows no redirect.
5. **A job changed under the phone.** The worker tells an open app that alerts came, and the app reads them again: a
   job of today's called off or given to another opens the dialog ADR 0246 opens for a refused write, once.
6. **The keys** are two Worker secrets, `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`, set together, a pair for each of
   staging and production (set 11 November 2026, owner's yes). Where none is set, as locally, each push is logged and
   not sent, and the phone does not ask for notifications.
7. **Three new tables** (migration 0209, owner's yes, 11 November 2026): `tech_alerts`, `push_subscriptions` (one a
   phone) and `tech_alert_kinds_off`.

## Departures

- **The settings** sit on the Alerts screen under "Send me", as the prototype has them, and Me's row opens it.
- **The bell's count** is square, the brand's edge, not the prototype's round badge.
- **The lock screen's words** leave out the client's name that the inbox shows (item 4).
- **Guides' list** says how many steps, without the prototype's length: a visit's length is its service's, which the
  phone does not hold for a kind.
- **Time to leave** in the inbox is said in the minutes left when the cron found it, within five minutes of the notice,
  since the cron runs every five minutes.
