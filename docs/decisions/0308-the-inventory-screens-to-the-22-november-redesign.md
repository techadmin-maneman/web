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
   prototype's sub-menu does (Inventory, and with it Requests, Money, Growth and Reports). A phone, which has no side
   navigation, keeps them as tabs at the head of each page; wider, only Stock's own views are tabs.
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

## Consequences

- A kit is named only a day ahead at most; over four weeks the city's figure is the one to plan by.
- `GET /api/stock` carries no cost.
