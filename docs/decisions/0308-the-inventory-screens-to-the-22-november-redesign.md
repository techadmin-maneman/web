# 0308. The Inventory screens, to the 22 November redesign

- Status: accepted
- Date: 2026-11-24
- Topic: The ops console

## Context

The redesign's fourth piece is Inventory (docs/prompts/ops-redesign.md, step 4.9): Stock with the "Whose stock" picker
(A8), reorder levels and the next four weeks' kit shortfalls (C10); the rest as the prototype draws it. The owner ruled
on 24 November how the shortfalls name a technician, what stands above On hand's table, and who sees the stock's
value.

## Decision

1. **An entry of several pages lists them beneath it in the navigation** while it is the current one, as the
   prototype's sub-menu does (Inventory, and with it Requests, Money, Growth and Reports). Their pages stay tabs at the
   head of each page too, but Inventory's on a desk with the navigation open: there only Stock's own views are tabs,
   as the prototype draws it. Short of a desk, or with the navigation folded to its icons, Inventory's pages are tabs
   again.
2. **Stock opens on the warehouse** (A8). "Whose stock" switches to one kit, every place side by side, or totals by
   zone or city, on one line with the chips that narrow a place's items and Find an item.
3. **A place's table says each item's reorder level** for that kind of place, as the server reads it, and Enough where
   it holds more; Low, Out and Below zero stay as they were.
4. **The next four weeks name a kit short for its technician's visits already allotted** (C10): "Send 15 ml to Imran".
   A visit is allotted at the evening's lock; a draft the plan may still move has no kit, so the rest of the weeks
   stays the city's total, short or Enough (`kits_short` on `GET /api/stock/demand`).
5. **Above On hand stand the prototype's figures alone**: items to reorder, kits short for booked visits, and the
   stock's value at cost. The per-place cards that went to a place are gone, as the owner ruled; a place is picked in
   Whose stock. The value is shown only to those who may already read unit costs, worked out in the console from
   `GET /api/consumables`.
6. **The other pages take the prototype's shape, keeping what they do**:
   - Counts says how many are due, starts a count from the page's action, and reads each item's class beside the list,
     changed in a drawer; each count's action (Count now, Review, Open) ends its row.
   - Purchasing says how many await approval ("Awaiting approval" for a drafted order); an unset letterhead is a line
     above the orders whose Set it opens its form, a set one the page's Letterhead; claims and returned pieces are drawn
     only while they hold something.
   - Supply plan says how many lines await approval; an event is added in a drawer. Its forecast reads item by week,
     wider than the prototype's, so it stays beneath the lines rather than beside them.
   - Quality starts a recall from the page's action, recalls and failure rates side by side and the value at risk
     beneath them, its table of lots too wide for a third of the row.
   - Usage marks a flagged technician's overage as a pill; the bars above the table, which said again what it says,
     are gone.
   - Items lists its consumables and hair systems side by side, and reads each service's expected use in a grid,
     changed in a drawer.
   - Suppliers names each country, and, for those who read the scorecard, the share of orders that came on time and
     whole over its window.
   - Stock's views stand under Stock in the trail ("Inventory / Stock / Expiring"); Labels lists each piece with its
     own Print label beside the batches printed together; Places counts the items each holds.
7. **What the prototype does not draw stays where it serves**: the lists' search and filters, a delivery's labels
   printed together, a lot's labels, and "Add a consumable", which adds a consumable alone.

## Consequences

- A kit is named only a day ahead at most; over four weeks the city's figure is the one to plan by.
- `GET /api/stock` carries no cost.
- Movements names whoever recorded a change by their sign-in, where the prototype names the person.
