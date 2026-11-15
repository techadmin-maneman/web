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
   and Care closing the chat. A chat on a number the client has since changed away from is read only up to the change.
4. **Its state**, read from those rows: `resolved` once Care closed the chat after it, or the client marked it sorted,
   with nothing from the client since, in the app or the chat, and Care's close settles every report the chat holds;
   `in_progress` once Care replied, passed it to the city or gave visits; `open` until then.
5. **What the client does.** `POST /api/me/problems` files one, as today, and answers its reference. On a report of
   theirs they may add an update (their words into its chat), mark it sorted, or reopen it, which says so in the chat
   and opens it again. New reports keep five a day; updates and reopenings have a daily limit of their own.
6. **Photos.** Up to three a report, sent after it with `POST /api/me/problems/{reference}/photos`, a JPEG of at most
   the size a visit photograph is kept at. A note in the client's chat says each came, and the console's routes list
   and open them (`GET /api/conversations/{id}/report-photos`), for the chat of whoever made them, on the number they
   hold now. The console draws them beside the chat with its screens, in this same change.
7. **The same log** lists the client's grievances (answered or not) and missed-visit disputes (open, refunded or upheld),
   each with its own state, beside the reports.
8. **The fit guarantee claim** (ADR 0256): a report on the fit (guarantee) about a first fit inside its guarantee opens
   the Tasks row "Fit guarantee claim", due by `task_sla_hours` from its first report, its facts carrying the fit's
   sign-off, how many photographs were sent and the chat they are read in, which the console's Tasks row draws with its
   screens, until Care close it with what was done. Reports on the fit meanwhile are the same claim; one after
   the close opens another.

## Consequences

- The Care chat stays one thread a client. A report's part of it is the stretch up to the next report, so a reply Care
  meant for an earlier report that comes after a later one reads under the later one.
