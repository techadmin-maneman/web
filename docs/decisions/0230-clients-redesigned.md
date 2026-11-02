# 0230. Clients and a client's page, to the November redesign

- Status: accepted
- Date: 2026-11-02
- Topic: The ops console
- Amends [0225](0225-the-console-on-a-desk-and-a-phone.md) with the redesign's fifth step

## Context

The fifth of the redesign's eight steps (ADR 0225): the Clients list and a client's page. The design's list heads itself with how many clients there are, how many fitted and how many need something; narrows by chips that carry their counts; and lists each client's city, stage with their package, next visit, what they need from us and what they have paid, each row ruled in the tone of how pressing its need is, with the page's range at its foot. A client's page heads itself with their initials, name, badges, and a line of facts, with Call, WhatsApp and Book a visit; sets what is overdue for them in a ruled panel with Take it and its step; has eight tabs in one row, each one table or timeline, with an empty tab one line and the next action; and at the right, four figures at a glance, the visit address with Edit, notes with a box to add one, and the Care person.

## Decision

1. **The list** (`apps/ops/src/clients/ClientList.tsx`) heads itself with the clients, the fitted, and those with a task open; its chips carry their counts; its columns are the client and their mobile, city, stage and package, next visit, what waits for them on Tasks, and what they have paid. A row is ruled red for a visit past its day or a task overdue, brass for a task open. Its foot gives the range shown of the total. On a phone each client is a row: their name over stage and city, and what waits for them or when they are next seen.
2. **The API's list** (`GET /api/clients`) gives each client's package and what they have paid, less refunds, by the same rule as their page, and on its first page how many stand where, in the city asked for (`src/domain/clients/client-list.ts`). What a client needs comes from the Tasks board the navigation already reads, so the list asks for nothing more.
3. **The head** of a client's page carries their initials (`Initials`), state and a badge once their replacement is past its day, and their mobile, city, month they became a client and package beneath (`PageHeader`'s `mark`, `beside` and `under`); Call, WhatsApp and Book a visit at its right.
4. **What waits on Tasks** for the client stands under the head, a ruled row a task, with how long it has left, Take it and the task's own step; nothing open draws nothing.
5. **The tabs** are Visits, Hair systems, Payments, Messages, Referrals, Consents, Photos and History, in one row that scrolls on a phone, and the page opens on Visits. A tab's one table stands bare, its panel's title read and not shown (`PageTitle`). Visits is one table: visits past their day first, ruled red, then to come, then done; with nothing to come, one line says so, what falls due next, the free visits left, and the way to book it (`EmptyState` `next`). Payments totals what was paid at its foot; payment links and invoices show only where there are any. Messages is the client's chat with Care. History is what their visits add up to and, for whoever may read the audit log, everything done on the record.
6. **At the right**, four figures (`FigureGrid`): paid to date, visits, replace by and free visits left; the address their visits go to, with Edit; the notes, with a box beneath to add one; and their Care person. Below a desk's width it stands beneath the tabs.

## Where the build departs from the files, and why

Every screen was set beside the design's files at 1440, and at 390 against ADR 0225's rules, as the phone frames draw no client page; each difference left has its reason here.

- **The list's chips are where clients stand, as the API answers: All, Booked, Fitted, Nothing booked.** The design's Needs us, At risk and Replacement due are task groups: Tasks lists and narrows them, and the list's Needs column and rules show them per client. A list narrowed by them would need the API to build the whole board for every page.
- **"With a task open" is left out of the head while the board is cut short** (`truncated`): a count of part of the board would be wrong.
- **No Download CSV, and no Add a client.** A file of every client's number leaves the console's access rules behind; reports give the figures. A client comes in by booking, on the site or in the app; the console books for clients it has (ADR 0229).
- **Replace by is the month,** as the head has written it since ADR 0059, not the day: the day a piece falls due is the order's, and Hair systems gives it.
- **The pieces have no photograph:** a piece has none of its own in the record; the client's photographs are on Photos. Each piece is a row of the tab's table, the live one's date in brass, rather than a card.
- **A visit has no Paid column:** a visit carries no amount; Payments has them.
- **Payments keeps its title, Payments and refunds,** as it lists refunds too; links and invoices stay their own tables beneath, where there are any.
- **The panels at the right keep the console's panel title,** in the serif, where the design writes a small label: one panel look across the console.
- **A tab's table keeps its phone look of a row's cells beneath one another,** where the design's rule for a phone is a row of two lines: its rows carry their own controls, cancelling, a code, a refund, which a phone's row leaves out. The Clients list, which carries none, is rows on a phone.
- **The Overview tab is gone,** its figures now at the right; the page opens on Visits, as the design's first tab, where it used to open on the overview.

## Consequences

- `test/worker/ops/ops-client-list.test.ts` holds the package, paid to date and the counts; `test/dom/ui-console-frame.test.ts` the head's new parts, the figures and the next-action line.
- The brand's console glyphs gain a handset for Call; the frozen set the site draws is unchanged.
