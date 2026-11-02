# Ops console redesign — words the redesign added

Each slot the redesign adds where the console had no words of its own. None waits: the owner ruled on 2 November 2026 that they are written under the console's copy rules (tight, only what the person needs, no word on how the system works), not left empty. Nothing here is taken from the design files. Change any of them in the content key named.

| Screen     | Slot                                       | Words                                                                 | Content key                |
| ---------- | ------------------------------------------ | --------------------------------------------------------------------- | -------------------------- |
| Navigation | The four groups                            | Work, People, Running the business, Admin                             | `shell.navGroups`          |
| Phone      | The tab bar's last tab, and its page       | More                                                                  | `shell.more`               |
| Header     | The search panel's heading over pages      | Pages                                                                 | `shell.palette.pages`      |
| Today      | The City head's home                       | City head                                                             | `today.homes.names.city`   |
| Today      | The title, Dispatch                        | Every visit today has a technician. / 2 visits need a technician.     | `today.greeting.dispatch`  |
| Today      | The title, Care                            | No one is waiting on a reply. / 4 clients are waiting on a reply.     | `today.greeting.care`      |
| Today      | The title, City head                       | Gurgaon is 78% booked today. / 78% booked today.                      | `today.greeting.city`      |
| Today      | The title, Finance                         | Rs. 72,000 collected today.                                           | `today.greeting.finance`   |
| Today      | The title, Inventory                       | 4 items below zero. / 9 items out of stock. / Every place is stocked. | `today.greeting.inventory` |
| Today      | Beneath Visits today                       | 6 done · 1 under way                                                  | `today.notes.road`         |
| Today      | Beneath Running late                       | Ravi Kumar, 25 min                                                    | `today.notes.late`         |
| Today      | Beneath Chats to answer                    | Oldest 38 min                                                         | `today.notes.oldest`       |
| Today      | Beneath Median first reply                 | Last 7 days                                                           | `today.notes.lastWeek`     |
| Today      | Beneath Collected today, on Finance's home | 4 payments                                                            | `today.notes.payments`     |
| Today      | Beneath Items below zero and Items out     | 3 places                                                              | `today.notes.places`       |
| Today      | How long a chat has waited                 | 38 min / 5 h / 3 days                                                 | `today.waited`             |
| Today      | Finance's payments, with none today        | No payments yet today.                                                | `today.noPayments`         |
| Today      | Inventory's places, with none to show      | Every place is stocked.                                               | `today.noPlaces`           |
| Today      | A side list's way to its page              | Open Dispatch, Open Messages, Open Payments, Open Stock               | `today.openPage`           |
| Tasks      | The four views                             | All, Mine, Unassigned, Overdue                                        | `tasks.filters.views`      |
| Tasks      | The table's columns                        | What, Who, Due, Owner                                                 | `tasks.columns`            |
| Dispatch   | The search beside the key                  | Find on the board                                                     | `dispatch.tools.label`     |
| Dispatch   | The head's steps                           | Previous day, Next day                                                | `dispatch.tools.previousDay` |
| Dispatch   | Beneath a technician's name                | South · 3 visits · 4.5 h booked                                       | `dispatch.day.rowMeta`     |
| Dispatch   | A technician's head on a phone             | Imran Qureshi · 3 visits                                              | `dispatch.day.phoneHead`   |
| Dispatch   | Beneath the row nobody is on               | 2 visits                                                              | `dispatch.day.nobodyMeta`  |
| Dispatch   | Who is free to take a visit                | Free to take it                                                       | `dispatch.drawer.suggest`  |
| Book       | A step's heading                           | 1. Visit, 2. Day, 3. Time                                             | `clients.visits.book.step` |
| Book       | The parts of a day                         | Morning, Afternoon, Evening                                           | `clients.visits.book.periods` |
| Book       | Beneath a day in the strip                 | 4 free / Full                                                         | `clients.visits.book.free` |
| Book       | A code, a word away                        | Add a discount code                                                   | `clients.visits.book.addCode` |
| Book       | The foot's action                          | Choose a time / Book Tue 3 Nov, 2 pm                                  | `clients.visits.book.bookAt` |
| Clients    | Beside the title                           | 4,603 clients · 312 fitted · 38 with a task open                      | `clients.list.sub`         |
| Clients    | Two new columns                            | Stage, Needs                                                          | `clients.list.stage`       |
| Clients    | The list's foot                            | 51–100 of 4,603                                                       | `clients.list.range`       |
| Client     | The head's facts and badge                 | Client since Nov 2026 / Replacement overdue                           | `clients.head`             |
| Client     | The head's call                            | Call                                                                  | `clients.head.call`        |
| Client     | The right's figures                        | At a glance: Paid to date, Visits, Replace by, Free visits left       | `clients.glance`           |
| Client     | Visits, with nothing to come               | Nothing booked / Service visit due 12 Nov. No free visits left.       | `clients.visits.nothingBooked` |
| Client     | Its way to book                            | Book a service visit                                                  | `clients.visits.bookKind`  |
| Client     | Messages, with no chat                     | No messages yet.                                                      | `care.clientChat.none`     |
| Client     | The last tab                               | History                                                               | `clients.history.title`    |
| Messages   | Beneath the chat's name                    | Waiting on us · 38 min · reply by Mon 21 Sep, 11:42 am                | `care.thread.waiting`      |
| Messages   | Our automatic messages, folded             | 3 automatic messages · Show them / Hide them                          | `care.thread.autos`        |
| Messages   | The reply box's other use                  | Note for the team                                                     | `care.compose.noteMode`    |
| Technician | Beside the name, and beneath it            | Working / On leave / Switched off; Trained to fit / Not trained to fit | `technicians.head`        |
| Technician | The head's actions                         | Call, Edit details                                                    | `technicians.head.call`    |
| Technician | The four figures                           | Visits to come; Last 90 days, 12 jobs; On time; Kit below zero, 4      | `technicians.figures`      |
| Stock      | Beneath a place's card                     | 4 below zero · 5 out · 2 low                                          | `stock.attention.counts`   |
| Stock      | A place's items narrowed                   | All items, Low or out, Expiring soon; Find an item; No item matches.  | `stock.narrow`             |
| Settings   | Staff, with nobody added                   | Nobody added yet.                                                     | `settings.staff.none`      |
| Money      | Partner commission's panel                 | Commission for the month                                              | `partnerCommission.monthTitle` |
| Supply plan | With no line to decide                    | To approve; Nothing to approve.                                       | `supplyPlan.toApprove`     |
| Client     | Referrals, with no invite                  | No invite.; Attach an invite                                          | `clients.invite.attach`    |
| Client     | Payments, the refund column, read aloud    | Refund                                                                | `clients.payments.refundColumn` |
| Client     | History, with nothing done yet             | Nothing done on this record yet.                                      | `activity.recordEmpty`     |
| Care numbers | With no chats, no remedies               | No chats in these days.; No remedies given in these days.             | `care.numbers.noReasons`   |
| Technician | Hours, how far from home                   | Takes visits within; 45 min drive of home, the setting for everyone   | `technicians.hours.reach`  |
| Items      | The lists' columns, and those retired      | Unit; Retired consumables; Retired hair systems                       | `settings.consumables`     |
| Suppliers  | Those no longer bought from                | Retired suppliers                                                     | `settings.suppliers.retiredTitle` |
| Client     | The visit buttons' column, read aloud      | Change                                                                | `clients.visits.actionsColumn` |
| Tables     | A phone's order, where heads are not shown | Sort by; As listed; Jobs ↑ / Jobs ↓                                   | `packages/ui/words.ts`     |
| Lists      | Each list's search                         | Find a city / a person / a supplier / a partner / an order or supplier… | each list's `find`      |
| Lists      | Action columns, read aloud                 | Withdraw; Remove; Settle; Receive or send back                        | each list's columns     |
| Quality    | Value at risk's last column                | What to do                                                            | `quality.riskColumns`      |
| Phone rows | Beneath a name where no column says it     | 96% on time; Leave from 5 Nov; 2 visits; Rs. 400 lost; Expires 3 Dec; Counted 26 Nov; Not counted yet; 4 referred · 2 fitted | each list's `phone` |
| Tables     | A phone's order                            | Sort: As listed; Sort: Jobs ↑                                         | `packages/ui/words.ts`     |
| Stock      | Expiring, with nothing expiring            | Nothing expires within 30 days.                                       | `stockViews.expiring.none` |
