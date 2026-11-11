# 0251. Hindi on every screen, and the sign-in redrawn

- Status: accepted
- Date: 2026-11-11
- Topic: Field work
- Builds on [0239](0239-technician-light-look.md), whose light look the sign-in now takes, and
  [0250](0250-guides-and-alerts.md), the last of the screens it puts into Hindi

## Context

PR 11 of the technician redesign (`docs/technician-redesign/PLAN.md`, decision 10) puts the app into Hindi. The brief
(`docs/prompts/tech-redesign.md`, "Hindi and language switching") asks for both languages on every screen, switched at
once, mid-visit too, with the technician's place kept. The prototype's catalog (`design/tech-redesign/strings-hi.json`)
words the lines the prototype draws: about 300 of the app's lines. The app's own lines, its states and refusals and the
words of the parts built since, it does not. The owner also asked for the sign-in to be redrawn from the screenshots
of `01-sign-in`, which no PR of the plan had named.

## Decision

1. **One catalog, said in the language now.** Every part of `apps/tech/src/content.ts` is read through `localised`
   (`apps/tech/src/lang/words.ts`): in English as written, in Hindi put into Hindi as it is read, a function's line
   included. A line the API gives, such as a checklist item, a consumable or a reason, goes through `sayNow` where it is
   drawn. A screen keeps no copy of its words, so a switch of language draws every screen again without remounting it
   and without a reload. A label read once at load would keep its first language, so a list of labels is read as it is
   drawn.
2. **Hindi as the prototype derives it.** `toHindi` (`apps/tech/src/lang/hindi.ts`) tries the exact line, then each
   pattern and template, then a line's parts across " · ", then a lower-case part with its capital, then weekdays and
   months where the line holds a figure. Whatever a rule holds is worded in turn, so "Map · 12 min drive" is Hindi
   throughout, while a name, a sector, a code or an amount stays as written.
3. **The app's own lines** are in `apps/tech/src/lang/app-hi.json`, read after the prototype's catalog in the same
   way, and the prototype's catalog wins where both hold a line. It also words the job sheet's committed lists and each
   guided task. Both files are a draft for a native speaker's review, the guide steps first.
4. **The choice is the phone's.** It is kept in the device record (`apps/tech/src/lang/kept.ts`) and read before the
   first screen is drawn, so the app opens in the language last chosen. The sign-in offers the other language by its
   own name at the top. Me has a Language row with a sheet of the two.
5. **A test holds every line to Hindi.** `test/node/front-ends/tech-hindi.test.ts` writes every line the catalog, the
   job sheet and the tasks can show, for a name, a count of two, one and none, and nothing at all. The lines without
   Hindi must be exactly those REPORT.md lists for the native speaker. That list is empty now, so a line added in
   English fails the test until it is worded or listed.
6. **The sign-in** takes the light look of the board's technician screens, as its screenshots are drawn:
   - the mark and the language at the top;
   - "Mobile number" over the field;
   - "Code sent to +91 …" under the title once a code is out;
   - "Change number" and the resend's count together under the code's boxes;
   - the one action in the bar at the foot.

   Its fifteen states keep their words and their order.

## Departures

- **The lock screen's words** stay English: the service worker is built apart from the app and keeps its own few
  words (ADR 0250).
- **What ops write**: a gate code, a grade or a city, or a checklist reworded in the console, shows as written until
  a catalog holds it.

## Consequences

- A new line in `content.ts` needs Hindi in `app-hi.json`, or a place on REPORT.md's list, before the test passes.
- The catalogs travel in the technician app's bundle: 187.9 KB gzipped with them, of its 200 KB budget.
