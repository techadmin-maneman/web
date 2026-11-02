# 0237. Every list sorts, a long one narrows, and its heads stand over their figures

- Status: accepted
- Date: 2026-11-02
- Topic: The ops console
- Amends [0236](0236-second-design-pass.md): its sorting and searching, the next phase

## Context

The owner asked why some large tables had nothing to narrow them by, and why not everything sorted. Ten of about seventy
tables sorted. Many put their figures right under heads set left, and some rows held a form that opened in place.

## Decision

1. **Every list of records sorts** by each column, through `useTableView`: Settings' cities, prices, registrations,
   staff, suppliers, partners, Care team, remedies and pay grades; Purchasing's orders, claims, returned pieces and
   supplier scores; Quality's recalls, failure rates and value at risk; Stock's on-hand, expiring, in transit and
   demand; Usage; Counts; a technician's kit; Spend; Partner commission; Care numbers and Funnel by channel.
2. **A list that can outgrow a screen is searched,** and a column of few values narrows it (a city, a status, a
   supplier). On a phone the order is chosen from Sort by.
3. **Tables whose order is their meaning keep it:** a time series (forecast, accuracy, the activity log), grouped lines
   (supply plan, a pay statement), the dispatch grid, a client's own records, the consents, the places' tree, and the
   grids of boxes (rates, targets). Packages keep the order the site offers them.
4. **A head over figures stands right,** wherever a table's cells are set right (`Table`'s `alignHeads`), so no head
   sits apart from its figures.
5. **A row's buttons are `RowActions`** in an `ACTIONS` cell at its end; **a row's form opens in a drawer:** a returned
   piece's write-off, a technician's items on Usage.

## Consequences

- Words added, in `design/ops-redesign/COPY-TODO.md`: each list's search, and the spoken names of action columns.
