# 0228. The header's city, within a person's reach

- Status: accepted
- Date: 2026-11-02
- Topic: The ops console
- Amends [0226](0226-the-console-frame-redesigned.md) on the city the header offers, and [0227](0227-today-by-home-and-tasks-as-one-table.md) on what Today's figures count

## Context

The header's city picker (ADR 0226) offered every city served or with a technician at work, whatever the person's grants. Today's tasks, money and chats counted every city the person works in, whichever city was chosen (ADR 0227). The owner ruled on 2 November 2026: tasks, payments and chats belong to a client, who has a city, so they follow the city; and the city the header offers is only what the person has access to: a city head sees their one city, a zone's head the cities of their zone.

## Decision

1. **The picker offers a person's own cities** (`placesSeen`, `src/policy/access.ts`): the cities any of their grants reaches, in any department at View or above. `GET /api/whoami` lists them, and says whether the person's grants reach every city (`every_city`). A person whose grants reach everywhere, or several cities, is offered every one of theirs at once, then each. A person whose grants keep to one city has that city, chosen, and no choice of every city. While the Staff list is not enforced, everyone reaches everywhere.
2. **Five reads take the city chosen** (`city`, `src/routes/schemas/city.ts`): the task board (`GET /api/tasks`, its counts and its low-stock badge), the day's money (`GET /api/payments`), the payments (`GET /api/payments/ledger`), the Care inbox (`GET /api/conversations`) and the Care numbers (`GET /api/care-numbers`). Each narrows to the city within what the caller's grants reach (`narrowedTo`): a city outside them reads as nothing, never past them. A task, a payment and a chat are in their client's city, by the one rule the Clients list uses (`clientCityOf`).
3. **The console asks with the header's city**: the task board, which the navigation's counts and Tasks both read, is read again as the city changes; Today's homes ask each of their reads with it.

## Consequences

- A chat from a number that is no client's has no city, and is listed only with every city chosen.
- The Care inbox and Care numbers stay a national Customer Care grant's to read; the city only narrows what such a person sees.
- Messages, Money and the other screens take the header's city as their redesign steps rebuild them.
