# Stock and purchasing, as it works now

Where hair systems and consumables are, how they move, and how more are bought.

## Places and the ledger

Stock is kept in a tree of places: the national warehouse at the top, a hub for a zone, a stockroom in a city, and each technician's kit, every place under one above it (`src/domain/inventory/stock-places.ts`). What each place holds is a ledger of movements, never a figure typed over (`src/domain/inventory/stock.ts`). A delivery brings a lot with the supplier's lot and its expiry, and what leaves a place leaves from the lot that expires soonest (`src/domain/inventory/stock-lots.ts`).

A hair system has a stock code for each product, base size, colour, grey and density (`src/domain/inventory/hair-systems.ts`), and every piece received is a unit with its own label and QR code; each movement moves the units it takes (`src/domain/inventory/stock-units.ts`). Stock sent between places leaves when it is sent and arrives only when the other end scans it in (`src/domain/inventory/stock-transit.ts`).

## Matching a client to stock

A first fit or a replacement needs a piece made to the client's latest hair profile, matched exactly to one stock code, never a near one (`src/domain/inventory/stock-match.ts`). Each hour the fits booked in the weeks ahead with no matching piece in reach become Stock at risk tasks (`src/domain/inventory/stock-risks.ts`). Where no stock code fits, ops raise a custom order for the client, paid by a link before its purchase order goes out (`src/domain/purchasing/custom-orders.ts`).

## Kits

Each evening the kit check holds each technician's kit against their visits tomorrow, and on the evening ops set, against the week ahead (`src/domain/inventory/kit-check.ts`, `src/domain/inventory/kit-week.ts`). The technician's app shows their kit by lot, soonest to expire first, with what is on its way to receive by scanning (`src/domain/inventory/kit.ts`).

## Watching it

- **Low stock**: a place at or below its level, one alert per item and place, closed once it is no longer low (`src/domain/inventory/low-stock.ts`).
- **Expiry and transfers**: each morning, lots expiring within ops' warning days and transfers overdue (`src/domain/inventory/stock-watch.ts`).
- **Cycle counts**: each morning a count task for each place and class whose period has passed; the counter sees only what to count, never what the ledger holds (`src/domain/inventory/cycle-counts.ts`, `src/domain/inventory/count-tasks.ts`).
- **Usage and shrinkage**: what each technician's visits were expected to use beside what they used (`src/domain/inventory/stock-usage.ts`).
- **Quality**: failure rates by stock code, lot and supplier, and the value at risk (`src/domain/inventory/stock-quality.ts`).
- **Recalls**: a lot blocked everywhere in one action, its wearers told and their replacements owed free (`src/domain/inventory/recalls.ts`).

## Buying

Suppliers, their terms and their price for each stock code are on the Suppliers page (`src/domain/purchasing/suppliers.ts`). A purchase order is drafted from a supplier's list and approved by an Operations manager, and by a second one above the amount ops set (`src/domain/purchasing/purchase-orders.ts`). A receipt takes what arrived into stock, each piece labelled, at its landed cost in rupees whatever currency the supplier bills in (`src/domain/purchasing/receipts.ts`, `src/config/currencies.ts`). Damage, a failed check or a piece failing inside warranty becomes a claim on the supplier (`src/domain/purchasing/supplier-claims.ts`), and each supplier has a scorecard (`src/domain/purchasing/supplier-scorecard.ts`).

## Planning

Once each planning period the demand forecast adds up its four layers for each stock code, city and period (`src/domain/purchasing/forecast.ts`), with the events calendar's lifts and drops (`src/domain/purchasing/demand-events.ts`). The supply plan drafts from it what each city needs over its supplier's lead time, with safety stock (`src/domain/purchasing/supply-plan.ts`); approving a line sends its transfer or drafts its order (`src/domain/purchasing/supply-plan-lines.ts`). How right the forecast was is kept once its first period passes (`src/domain/purchasing/forecast-accuracy.ts`).

## What ops change, and where

Levels, warning days, count periods and tolerances, kit checks, approval amounts and planning periods are Settings · Rules (the Stock, Purchasing and Supply plan sections). Places, items and lots are on Stock; suppliers on Suppliers; orders, receipts and claims on Purchasing.

## Decisions still worth reading

- [0155, the stock place tree](../decisions/0155-the-stock-place-tree.md) and [0157, lots and expiry](../decisions/0157-lots-and-expiry.md).
- [0161, pieces as units](../decisions/0161-pieces-as-units.md) and [0173, matching a client to stock](../decisions/0173-matching-a-client-to-stock.md).
- [0166, purchase orders](../decisions/0166-purchase-orders.md) and [0167, receipts and landed cost](../decisions/0167-receipts-and-landed-cost.md).
- [0179, the demand forecast](../decisions/0179-demand-forecast.md) and [0180, the supply plan](../decisions/0180-supply-plan.md).
