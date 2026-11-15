# 0258. The issue log

- Status: accepted
- Date: 2026-11-16
- Topic: Messages and the CRM
- Builds on [0256](0256-fit-guarantee-setting.md), whose claim it opens

## Context

A client's report from the app went into their Care chat as a message and left no record of its own: no reference, no
state, nothing the app could list (sync audit G1, plan gap G3). The brief's W6 asks for an issue log: each report with
its state, read from the rows that exist; the prototype's nine categories, mapped to Care's closure reasons; up to three
photos; grievances and missed-visit disputes in the same log; the five-a-day limit kept. The prototype draws a reference
for each ("MM-ISS-0032"), the client's update, marking one sorted, and reopening it.

## Decision

1. **Storage** (migration 0212; the ratings' table takes 0213):
   - `client_reports`: one row a report, with its number (shown "MM-ISS-0032"), the client, the category, the visit it
     is about, their words, the Care chat it went into, and when the client marked it sorted or reopened it.
   - `client_report_photos`: up to three a report, each an object in the client photos bucket.
2. **Categories.** The fit (guarantee), edges lifting, itching or irritation, colour or shine, shedding, fit or comfort,
   a visit or technician, payment or refund, something else. Each maps to one of Care's closure reasons, which the
   console's close opens on.
3. **A report's thread** is its own words, then what its Care chat holds from it until the client's next report: Care's
   replies, under the first name the client knows them by, never the after-hours answer; the client's own later words,
   and every update or reopening sent to it from the app, wherever it falls; a City matter passed on; free visits given;
   and Care closing the chat. Each chat is read from when the client came to it, their first report in it or the
   change that gave them its number, and one on a number they have since changed away from only up to the change.
   An update or reopening sent after a change of number goes to the chat on the new one, and is read there.
4. **Its state**, read from those rows: `resolved` once Care closed the chat after it, or the client marked it sorted,
   with nothing from the client since, in the app or the chat; `in_progress` once Care replied, passed it to the city
   or gave visits; `open` until then. Care read a client in the chat on the number they hold now: its close settles
   each report of theirs the log reads open, wherever it was filed, leaves one it reads settled as it was, and opens on
   the reason of the latest open one. Both read the log's own rule, so the three never disagree.
5. **What the client does.** `POST /api/me/problems` files one, as today, and answers its reference. On a report of
   theirs they may add an update (their words into its chat), mark it sorted, or reopen it, which says so in the chat
   and opens it again. New reports keep five a day; updates and reopenings have a daily limit of their own.
6. **Photos.** Up to three a report, sent after it with `POST /api/me/problems/{reference}/photos`, a JPEG of at most
   the size a visit photograph is kept at. A note in the chat on the client's number says each came; it counts as the
   client writing from the app, as an update does, so it opens the chat (or makes one) and Care's reply clock runs
   from it. The console's
   routes list and open them (`GET /api/conversations/{id}/report-photos`), for the chat of whoever made them, on the
   number they hold now. The console draws them beside the chat with its screens, in this same change.
7. **The same log** lists the client's grievances (answered or not) and missed-visit disputes (open, refunded or upheld),
   each with its own state, beside the reports.
8. **The fit guarantee claim** (ADR 0256): a report on the fit (guarantee) about a first fit inside its guarantee opens
   the Tasks row "Fit guarantee claim", due by `task_sla_hours` from its first report, its facts carrying the fit's
   sign-off, how many photographs were sent and the chat on the client's number now, where they are read, which the
   console's Tasks row draws with its
   screens, until Care close it with what was done. Reports on the fit meanwhile are the same claim; one after
   the close opens another.

## Consequences

- The Care chat stays one thread a client. A report's part of it is the stretch up to the next report, so a reply Care
  meant for an earlier report that comes after a later one reads under the later one.
- The log, and so Care's close, read a client's newest fifty reports; an older one is left as it stood.
- A report, an update or a photograph from the app counts as the client's last words in the chat, as a report from
  the app did before: Care's reply clock runs from it, and so does the reply window the console reads, though only the
  client's own WhatsApp message opens WhatsApp's.
