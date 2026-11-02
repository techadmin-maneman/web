# 0231. Messages, to the November redesign

- Status: accepted
- Date: 2026-11-02
- Topic: The ops console
- Amends [0225](0225-the-console-on-a-desk-and-a-phone.md) with the redesign's sixth step

## Context

The sixth of the redesign's eight steps (ADR 0225): Messages. The design sets the inbox in one box of three columns: the chats, with their views and a search above, each a row with the client's initials, what they last said and how long they have waited, ruled in the tone of how late our reply is; the chat open, headed by who and how long it has waited, with Close chat, our automatic messages folded into one line, and at its foot the quick replies, the reply box, Reply or a note, and Send; and at the right the client, their facts, the ways into their page, and what Care do for them. On a phone it is the list of chats.

## Decision

1. **One box, three columns** (`apps/ops/src/care/MessagesScreen.tsx`): the chats, the chat open, and who it is with (`./ChatClient.tsx`). Short of a desk's width, who it is with stands beneath the chat; short of a laptop's, the chat beneath the list.
2. **The views are chips** in one row that scrolls sideways; **a chat is a row** (`ListRow` with `mark` and `current`): initials, name, last line, how long it has waited on us or the day it last moved, red once our reply is late, brass while it waits on us.
3. **The chat's head** names who it is with, how long it has waited and when our reply is due, and holds Close chat, which asks what it was about in a drawer. **Our automatic messages in a row fold into one line**, opened on asking.
4. **The foot** has the quick replies as chips over the box, Reply or Note for the team, and Send.
5. **Who it is with**: the client's facts and a button for each part of their page; their Care person, moved from here; free service visits and a matter for their city's team; a number we don't know made a client here.

## Where the build departs from the files, and why

Every screen was set beside the design's files at 1440 and at 390; each difference left has its reason here.

- **The page keeps its title,** where the design draws only the crumb: every page heads itself (ADR 0226).
- **Five views, without counts,** where the design draws three with counts: the API has five, and counts none of them; the navigation's count is the one waiting on us.
- **A row has no line for what the chat is about:** the API records that as a chat closes, not while it is open. The Care person and the number left the row for the column beside the chat.
- **No Assign in the chat's head:** the API assigns a client's chats by their Care person, moved in the column at the right.
- **No "What it's about" choice beside the chat:** Close chat asks it, as the API records it then.
- **Book or move a visit and payment links open the client's page,** at its Visits and Payments, where they are done; the column does not book in place.
- **No warranty among the client's facts:** the record has none.
- **On a phone the chat opens beneath the list,** where the design draws the list alone; and its rows carry the initials, as the desk's do.

## Consequences

- `ListRow` gains `mark` and `current`; `Initials` a small size (`test/dom/ui-phone-and-pickers.test.ts`).
- `Thread` no longer closes itself: the inbox keeps it open until another is chosen, and a client's page shows theirs alone.
