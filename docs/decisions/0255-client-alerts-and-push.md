# 0255. Client alerts and push, and the live visit

- Status: accepted
- Date: 2026-11-12
- Topic: Messages and the CRM
- Builds on [0250](0250-guides-and-alerts.md), whose payloadless push it reuses, and [0145](0145-technician-presets.md),
  whose updates it carries to the app

## Context

The technician's live words, on the way, running late and at the gate, went only to WhatsApp (ADR 0145), and the
client app's visit stopped at booked, arrived, in progress and done, with no step. With WhatsApp off, as in production
today, the client was told nothing. The client app had no inbox and no push (sync audit C3, C4). The owner ruled on
12 November 2026 (ruling 3) that the technician's live updates reach the app, as in-app alerts and web push; and that a
technician swap stays silent (ruling 5, ADR 0115).

## Decision

1. **The live visit on the client API.** `VisitSummary` and `VisitDetail` gain `latest_update {kind: on_the_way |
running_late | at_the_gate, minutes, at}` from `technician_updates`, `step {index, of, name}` from the last
   `job_events` row and the visit's plan, and `waits_until` while the technician is at the door (the booked start plus
   `no_show_wait_min`). The plans' step names move to a module both apps read. Nothing about the technician's place or
   phone is carried.
2. **Alerts.** `client_alerts` (migration 0211) is written beside each outbound message of a kind in `MESSAGE_KINDS` that
   concerns a client, and beside each live event of item 1 and of the sign-off (ADR 0254), whether or not WhatsApp is on.
   Each is written once, by its own key. `GET /api/me/alerts` lists them newest first; `POST /api/me/alerts/read` marks
   them read. A technician swap writes none.
3. **Push.** `client_push_subscriptions` (migration 0211) keyed to the client's session, with the same payloadless VAPID
   push as ADR 0250 (`src/providers/web-push.ts`): the service worker reads the inbox with the client's own session and
   shows what is new, so nothing about a visit passes through a push service. A subscription goes with its session: a
   session signed out or revoked drops it. The app asks for notifications only after the first visit is booked, from a
   row on Home, never on load.
4. **In the app.** News arrives as the phone-style banner and a row under the bell; the next-visit card follows the
   visit live (on the way, running late by N minutes, at the gate, at your door until, step n of N, sign-off, done).
