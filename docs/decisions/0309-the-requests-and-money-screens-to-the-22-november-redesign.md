# 0309. The Requests and Money screens, to the 22 November redesign

- Status: accepted
- Date: 2026-11-24
- Topic: The ops console

## Context

The redesign's fifth piece is Requests and Money (docs/prompts/ops-redesign.md, step 6): the prototype draws each
request as a row in a table, decided from the row or a drawer, and Money's pages with their figures, filters and
monthly tables. What the console already does there stays (section B2 and B3 of the changes for approval): each
request's full detail and steps, Payments' row detail, refund and date range, Charges, Technician pay's month and
Partner commission.

## Decision

1. **A request is a row, decided from it or in a drawer.** Concerns, Number changes and Deletion requests each list
   what waits as a table, with how many beside the page's title ("2 open", "3 to decide"). The client's name opens the
   request whole in a drawer: who asked and when, how to reach them, and the decision. A number change is approved
   from its row; a decline, an erasure and keeping an account with a reason each open the drawer at that step, since
   each asks for something first. A task's link to a request opens its drawer. The redesign's words are taken: Approve
   and Decline, Erase, and "Keep, with reason".
2. **What the data does not hold is not drawn.** A concern has no owner and no remedy: it is the client's word about
   their data, answered in writing, so its table has neither column and its drawer no remedy.
3. **Charges says how many wait**, counting the no-shows and the disputed charges, and sets the two queues side by side
   on a wide desk, today's rulings beneath them a row each, then the day's money and the charges it was kept on.
4. **Payments takes the redesign's words** (Download CSV, "Client or reference", "In the books": Synced or Not yet)
   and keeps the columns it has that the redesign leaves out, such as what was refunded. The figures for payments owed
   and UPI to record open their kind on the Tasks board, where each is recorded, rather than a second form here.
5. **Technician pay is a row each technician**: their grade, their visits by kind (the kinds the month holds) and their
   pay, with the month's total; the month beside the title, "so far" while it runs; Download CSV in the page's head; a
   technician with no grade named above the month, with the way to set one. The CSV keeps its line each by city and
   rate, as payroll reads it.
6. **Partner commission says its month beside the title**, and keeps its columns and "Record payment", which takes
   the payout's amount, day and reference where the redesign's "Mark paid" takes nothing.

## Consequences

- The shared queue of cards (DecisionQueue) still draws Charges' no-shows and disputed charges, which the redesign
  draws as rows with their buttons, as the queue's cards already are.
- A request's facts are a click away rather than on the page, so a decision reads them in the drawer.
