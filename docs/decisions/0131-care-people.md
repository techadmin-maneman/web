# 0131. Each client's Care person

- Status: accepted
- Date: 2026-10-12
- Topic: Messages and the CRM

## Context

The support scope gives every client a named Care person: one member of the team who knows them and answers their chats, rather than whoever happens to open the inbox. The inbox (ADR 0129) and replies (ADR 0130) work without one.

## Decision

1. **The Care team is read from the Staff list**: active staff with a Customer Care grant of Act or Manage for all cities. There is no separate roster to keep.
2. **A client is given a Care person at their first chat**: whoever on the team has the fewest clients, the first by address between equals. A number we don't know is given nobody; nothing is given while the team is empty.
3. **A Customer Care manager moves a client** to another of the team from the client's chat. The move is audited with who they went to; the audit never keeps what was said.
4. **The inbox shows each chat's Care person**, and Mine lists the open and waiting chats of the signed-in person's own clients.
5. **The client's data export names their Care person**, and since when. Erasing a client deletes the row, so an erased record counts towards no one's clients.

## Consequences

- Someone who leaves the team keeps their clients until a manager moves them. Shifts and cover, which hand a chat to whoever is on while its Care person is away, come next in support phase 3.
- The app's Support card names the Care person once staff have display names; today the team is known by e-mail.
- Tests: `test/worker/care/care-people.test.ts`, `test/dom/ops-messages.test.ts`.
