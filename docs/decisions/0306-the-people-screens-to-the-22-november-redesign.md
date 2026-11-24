# 0306. The People screens, to the 22 November redesign

- Status: accepted
- Date: 2026-11-24
- Topic: The ops console
- Amends [0304](0304-the-work-screens-to-the-22-november-redesign.md) on the shared parts' look

## Context

The redesign's third piece is People: Clients, a client's page and Technicians (docs/prompts/ops-redesign.md, steps
4.5 to 4.8). The owner approved on 22 November the strip of clients recently opened (C2), a hair profile's "was X"
differences (C4) and a technician's start date (C5, ADR 0305), and that "Lead from a call" becomes "Add a client"
(A6). Book a visit was drawn to the redesign with the first piece.

## Decision

1. **The shared parts' look, through roles whose defaults keep the other apps as they were** (packages/ui/base.css):
   a person's initials a circle in Plex on the console's chosen tint, 30 px in a list and 52 px heading a page; a
   panel's figures named first, in 12 px over Plex's semibold at 18 px; a tab may say how many it holds; a table's
   row may lead with a mark before its name.
2. **Clients**: the clients opened this session are a strip of six cards above the list, each with where they stood;
   the list's rows lead with initials and say where a client stands and what waits for them as pills. Add a client is
   the page's one action.
3. **A client's page**: the head names their Care person. Visits says how many it lists; Referrals reads How they
   found us. Alerts and notes are added from Add in their cards' heads, in a drawer, and say None. when there are none;
   a note is still changed where it stands. A visit to come has Move beside Cancel, which opens it on the board.
4. **The hair profile** says beside each field that changed what it was in the version before.
5. **Technicians**: the roster counts over Last 30 days, Last 90 days or Last 12 months, a segment each, keeping ops's
   own period; each row leads with initials over whether they fit, two lines rather than the board's one.

## Consequences

- The client app, the technician app and the site look as they did.
- A client's list keeps its own views (Booked, Fitted, Nothing booked) until the owner rules on the redesign's
  stages; what else the People screens still draw differently from the prototype is listed in the pull request.
