# 0232. A technician's page, Stock and Money, to the November redesign

- Status: accepted
- Date: 2026-11-02
- Topic: The ops console
- Amends [0225](0225-the-console-on-a-desk-and-a-phone.md) with the redesign's seventh step

## Context

The seventh of the redesign's eight steps (ADR 0225): a technician's page, Inventory and Money. The design heads a technician's page as it heads a client's, with their initials, where they stand today and their facts, Call and Edit details, and four figures beneath: visits, jobs, how often on time and their kit below zero, the Kit tab counting it too. Inventory sets what needs attention as a card a place, ruled by how short it is, and narrows a place's items by chips that count them and a search. Money sets four figures over the payments.

## Decision

1. **A technician's page** (`apps/ops/src/technicians/TechnicianHead.tsx`): the record head (ADR 0230) with Working, On leave or Switched off; their number, city, fitting and hours beneath; Call, and Edit details, which opens their details in a drawer, switching off and deleting with them. Four figures: visits to come, jobs over the roster's period, on time, and kit below zero, which the Kit tab counts in red. A tab's panel titled as the tab shows no title again.
2. **Stock** (`apps/ops/src/stock/OnHand.tsx`): what needs attention is a card a place, below zero ruled red, out in the warning's tone, low in brass, its counts beneath its name; pressing one shows its stock. A place's items narrow by chips with their counts, All items, Low or out and Expiring soon, and a search by name.
3. **Money** (`apps/ops/src/ledger/MoneyFigures.tsx`): collected today, payment links owed, UPI to record and refunds processing above the ledger, for the header's city, which the ledger now follows too; Export CSV in the head.

## Where the build departs from the files, and why

Every screen was set beside the design's files at 1440; each difference left has its reason here.

- **Technicians opens on the roster,** where the design's entry opens one technician: the roster is how one of many is found.
- **No menu of more:** switching off and deleting sit with the details, behind Edit details.
- **Visits to come, not this week's:** the roster counts the visits to come.
- **The Kit tab's way is Record a movement in Stock,** where the design draws Send stock and Count this kit: a transfer is a movement, and counts are set on Counts.
- **Stock keeps its title and its own row of views** (On hand, Movements, Labels, Places) beneath Inventory's tabs: they are views of one page, not pages of their own; and no line counting places by kind.
- **A card's action is Show,** where the design offers Count, Transfer or Order: those are done on Counts, as a movement, and on Purchasing.
- **No Low at column:** the API says whether an item is low, not the level, which is set per item on Items. **No Print labels or New order in the head:** Labels is a view of Stock, and an order is raised on Purchasing.
- **Money's page is titled Payments,** its tab, Money being the group; **"Needs you" is two named counts,** payment links owed and UPI to record, each a group on Tasks.
- **The days stay From and To,** where the design offers "Last 7 days": exports and Books are reconciled over exact days. **The ledger keeps its Reference, Refunded and Books columns and Refund,** as Finance work there; **no Record a payment:** a UPI payment is recorded from its task.

## Consequences

- `GET /api/payments/ledger` is read with the header's city, as ADR 0228 has it for every figure.
