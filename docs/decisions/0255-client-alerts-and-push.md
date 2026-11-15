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
2. **Alerts.** `client_app_alerts` (migration 0211; `client_alerts` already names ops' alerts about a client) is written
   by triggers, whatever wrote the row they fire on, whether or not WhatsApp is on:
   - beside each outbound message, but those that are WhatsApp's alone (`WHATSAPP_ONLY` in
     `src/policy/client-alerts.ts`: the site's answers to a number we know, the waitlist's confirmation, the answer to a
     STOP), and a technician's word or arrival written already skipped, as heard too late to tell. One waiting for
     what it carries, a try-on's look, is written once it is queued. The live events of item 1 are such messages: the
     technician's word, named as the visit names it, and their arrival;
   - each time a technician asks for the client's sign-off (ADR 0254), the first time and again after a flag;
   - and, by the change itself, a move or a move proposed for a client who agreed to no WhatsApp about visits, whom ops
     are to call: the app's alert is all they hear of it otherwise.

   Each is written once, by its own key. `GET /api/me/alerts` lists the last 30 days', newest first, each with the
   visit it is about and a technician's word with its minutes; `POST /api/me/alerts/read` marks them read; the cron
   deletes older ones. A technician swap writes none: it writes no message.

3. **Push.** `client_push_subscriptions` (migration 0211) keyed to the client's session, with the same payloadless VAPID
   push as ADR 0250 (`src/providers/web-push.ts`): the service worker reads the inbox with the client's own session and
   shows what is new, so nothing about a visit passes through a push service. The cron pushes each alert not yet pushed
   or read, within the 30 minutes a push lives, to the client's live sessions that subscribed: the newest five
   (`PUSH_SESSIONS_MAX`), so no client's alert costs more than five of a run's calls. A session revoked
   or ended takes no pushes; signing out drops its subscription at once, and the sweeper drops any other's before it
   deletes the session. The app asks for notifications only after the first visit is booked, from a
   row on Home, never on load.
4. **In the app.** News arrives as the phone-style banner and a row under the bell; the next-visit card follows the
   visit live (on the way, running late by N minutes, at the gate, at your door until, step n of N, sign-off, done).

## Consequences

- **D1 counts a trigger's rows in a statement's changes.** Migration 0211's triggers on `outbound_messages` make an
  insert there report two changes, not one. Code that reads a message insert's changes reads its returned row instead,
  as the arrival notice now does. Until this release's code lands after the migration, the deployed arrival notice reads
  its insert as not written and leaves the message to the sweeper, which sends it within five minutes.
