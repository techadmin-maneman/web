# Client app redesign: the report

The brief's final report (`docs/prompts/client-redesign.md`, "Delivery", step 5), against `PLAN.md`. Where something is
still owed, it says so and by whom.

## 1. Every current state, and where it went

Each row of `PLAN.md` section 3, the screenshots `01` to `39` and the states only the code holds (audit section 9
included). **Done** means built, reviewed and merged.

### Sign in

| Current                                                                                                 | New                                                       | State           |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------- |
| 01 mobile number · 02 WhatsApp code                                                                     | Sign in (number), then the code screen with its countdown | Done, #881 #885 |
| 03 number not recognised                                                                                | "No booking on this number?" with a free consultation     | Done, #881      |
| code: SMS fallback, wrong / expired / limited / failed, session ended note, help, one-tap from the site | The same two screens, each refusal under its field        | Done, #881      |

### Home

| Current                                                            | New                                                                          | State                |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------- | -------------------- |
| 04 consultation booked                                             | Next-visit card, consultation                                                | Done, #881 #885      |
| 05 fitted client                                                   | Next-visit card (service), Your hair system, free service visits, last visit | Done, #881 #885      |
| 06 loading · 07 offline · 08 error                                 | Home skeleton · offline bar over the kept Home · Home failed with Try again  | Done, #881           |
| code: visit stages arrived / in progress / closing / done / missed | The live card: at the door, step n of N, sign-off, done; the missed visit    | Done, #879 #881 #886 |
| code: `being_booked`                                               | Next-visit card, paid and being booked                                       | Done, #881           |
| code: `payment_owed`                                               | A row on Home with Pay, which opens the Razorpay link                        | Done, #881           |
| code: `remake` (partly done, recall)                               | Remake card, "We'll call to set a day" (ADR 0192)                            | Done, #881           |
| code: proposed move                                                | "We need to move your visit": accept or pick another time                    | Done, #881           |
| code: consultation recap, first-fit offer                          | First-fit path: in stock (book and pay) or made to order                     | Done, #881           |
| code: custom order states                                          | Same path, from `/api/me/custom-orders`                                      | Done, #881           |
| code: invoice prompt                                               | A row under the card, opening the invoice                                    | Done, #881 #885      |
| code: credits tile and expiry                                      | Free service visits row, and Rewards                                         | Done, #881           |
| code: address missing before any start                             | Address row on Home; booking's address step before any time (ADR 0079)       | Done, #881 #885 #887 |
| code: book next, was due, replacement prompt, `/replacement`       | Book on the card; Your hair system says when the replacement opens           | Done, #879 #881      |
| code: requested (self-serve off)                                   | Request mode, "Ask for a time"                                               | Done, #881           |
| code: update ready, not found, page failed                         | Restyled                                                                     | Done, #881 #884      |

### Visits

| Current                                                         | New                                                                                        | State                |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------- |
| 09 visits                                                       | Visits: Upcoming / Past, and Issues                                                        | Done, #881 #884      |
| 10 a visit and its photos                                       | Past visit: outcome, photos, technician, sign-off and its time, guarantee, rating, invoice | Done, #881 #882 #884 |
| code: cancelled, missed by us, partly done                      | Past visit's outcome line                                                                  | Done, #881           |
| code: missed visit, dispute open / ruled / closed               | Missed visit: the wait, the charge, "Dispute this charge" until its day and time           | Done, #881 #884      |
| code: invoice ready / free / held / late, ask for it            | The visit's invoice row (ADR 0056)                                                         | Done, #881           |
| code: pay at the visit (history)                                | The visit's payment line, history only                                                     | Done, #881 #884      |
| code: note to the technician, add to calendar, report a problem | The visit's Change and Add a note; the calendars on booking; Report an issue               | Done, #881 #886 #887 |

### Booking, change and cancel

| Current                                                                                               | New                                                                                                | State           |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------- |
| 11 pick a day · 12 pick a start                                                                       | One screen: the earliest time, the days with what each has left, the times by part of day          | Done, #881 #887 |
| 13 pay · 14 first fit · 15 on a free visit                                                            | Review: the time held, the facts, the code box, the credit, the I-agree tick; Rs. 0 skips Checkout | Done, #881 #887 |
| 16 payment failed · 17 hold expired · 18 confirmed                                                    | Failure and Checkout closed on the review; the time released; the wait; booked on navy             | Done, #881 #887 |
| code: not served / waiting list, first fit not yet, with ops, full days, offered full, start gone     | Same steps, current words                                                                          | Done, #881 #887 |
| code: code invalid / removed, Checkout failed to start, slow confirm, paid hold refunded, credit gone | Same steps, current words                                                                          | Done, #881 #887 |
| 19 change free · 20 cancel free · 21 change with a late fee                                           | Change: the visit and its day over Move and Cancel; the charge by kind inside the notice           | Done, #881 #886 |
| (new)                                                                                                 | Replacement: the tier step, Keep it / Upgrade / Downgrade / Switch                                 | Done, #891      |

### Photos

| Current                                                                  | New                                                          | State           |
| ------------------------------------------------------------------------ | ------------------------------------------------------------ | --------------- |
| 22 timeline · 23 before and after · 24 download                          | Photos: timeline, slider with its knob, viewer with download | Done, #881 #884 |
| 25 none yet · 26 loading                                                 | Empty (try-on link) and skeleton                             | Done, #881      |
| code: try-on looks kept, link expired and read again, large photo failed | Try-on looks group; same refresh; inline error               | Done, #881      |

### Payments, now under Profile

| Current                                                                                   | New                                                                   | State           |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------- |
| 27 payments · 30 none yet                                                                 | Profile → Payments and invoices, by month                             | Done, #881 #884 |
| 28 a payment · 29 receipt unavailable                                                     | Payment (or Refund): Razorpay method and payment ID, receipt, invoice | Done, #881 #884 |
| code: late fee, missed-visit charge, discount, owed (Pay), credits moved, refund statuses | Rows and lines, restyled                                              | Done, #881 #884 |

### Refer, now Rewards

| Current                                                                                                       | New                                                              | State           |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------- |
| 31 refer · 32 choose a card · 33 share · 34 share failed                                                      | Rewards: the ways to send, what the friend sees; the share sheet | Done, #881 #885 |
| 35 switch off the photo card                                                                                  | Rewards: the switch                                              | Done, #881      |
| 36 who you invited · 37 nobody yet                                                                            | Rewards → Who has been fitted                                    | Done, #881      |
| code: closed until the first consultation (ADR 0218), card composing / failed, card revoked, `pending_invite` | Rewards' locked state and the same lines                         | Done, #881      |

### Profile

| Current                                                                              | New                                                     | State           |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------- | --------------- |
| 38 profile                                                                           | Initials (top right) → Profile                          | Done, #881 #884 |
| 39 account                                                                           | Account: number change, sessions, data export, deletion | Done, #881 #884 |
| code: address form, building search, not served, visit booked lock                   | Profile → Address                                       | Done, #881 #885 |
| code: consents and their switches                                                    | Profile → Privacy and messages                          | Done, #881 #885 |
| code: number change (codes, proven, waiting, withdraw, limited, confirmed, rejected) | Account                                                 | Done, #881      |
| code: grievances (raise, sent, limited, answered), Care person and hours             | Profile → Help, and the issue log                       | Done, #879 #881 |

Every old path still opens its page (`PLAN.md`, "Routes"), as `test/node/front-ends/app-route.test.ts` holds.

## 2. The work items

| #   | Work                                                                         | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | The plan and the ADRs                                                        | Done: `PLAN.md`; ADRs 0252 to 0257, 0259 and 0260                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 1   | Look file, tokens, Plex, base parts; the toast                               | Done, #881                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2   | Shell, tabs, top bar, Profile and its pages, redirects                       | Done, #881 #884                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 3   | Home and the next-visit card; Your hair system; the four hair systems        | Done, #881 #885                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 4   | Booking and Razorpay Checkout; change and cancel; request mode; staging keys | Done, #881 #886 #887                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 5   | W1 replacement only when due; W2 change of hair system at booking            | W1 and W2's server side done, #879 (ADR 0253); the app's tier step, #891; a size no stock code matches, #892: the visit is refused `made_to_order` and the app says it is made to order in the client's size, with a way to ask on WhatsApp, ops ordering and booking it (the owner's ruling of 16 November)                                                                                                                                                                                                                                                                                                                        |
| 6   | W9 values on the API; the custom-order and one-visit paths                   | Done, #879 #881                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 7   | W3 live fields; the live card                                                | Done, #879 #881 #886                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 8   | W4 sign-off across the three apps                                            | Done, #879 #881 (ADR 0254)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 9   | W5 client alerts and push; the inbox                                         | Done, #879 #881 (ADR 0255)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 10  | W6 issue log; W7 fit guarantee; the console's view of both                   | Done, #879 #881 (ADRs 0256, 0259)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 11  | W8 ratings and the technician's quality figure                               | Done, #882 (ADR 0260)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 12  | Photos and Rewards                                                           | Done, #881 #884 #885                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 13  | Razorpay code: items 16, 17, 154; webhook and refund tests                   | **Owed**: planned, waiting on the owner's yes and the Books account to name (section 5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 14  | States, offline, errors, 360 px and 130% text; this report                   | Done with this PR for the sign-in number screen, every page (a visit to come, a past one and a payment open), the change sheet as it opens, and the booking sheet's day and time and review, at 390 and 360 px and at 130% text (`e2e/app/large-text.e2e.ts`); it found and fixed one break, the four hair systems' facts. **Owed**: the same measure of the code and help screens, the offline bar, a page that failed, the loading skeletons, an issue's page, the change sheet's move and cancel steps, the booked screen and the waits, and the other sheets: the invite's share sheet, Add a note, the sign-off and the rating |
| B   | Production on Razorpay alone                                                 | **Owed**: waits on the owner's items in section 5; the owner merges                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## 3. Backend gaps, and how each was met

| Gap                              | Met by                                                                           | Mock left |
| -------------------------------- | -------------------------------------------------------------------------------- | --------- |
| G1 Your hair system on `/api/me` | `hair_system` on `/api/me`, with W1 (#879)                                       | None      |
| G2 Compare the four hair systems | `GET /api/packages` (#879)                                                       | None      |
| G3 Issue references              | A reference per report, written by the issue log (#879)                          | None      |
| G4 Request mode                  | The pick goes to ops as a WhatsApp message, drawn as the prototype's form (#881) | None      |

The app reads no mock: every figure it shows comes from the API (`test/node/apps/app/app-no-figures.test.ts`).

## 4. What does not match the prototype, and why

Each is recorded, with its reason, in ADR 0252's "Departures"; here, by the screens it touches.

| Screen                    | What differs, and why                                                                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every page under a tab    | A way back and no tab bar, as the prototype draws every page that is not a tab's own, a loading page too; its action in the gutter under a hairline                              |
| Visits, Past              | No photo thumbnail or amount: `GET /api/visits` carries neither. Visits' record stays beneath Past                                                                               |
| Visits and Payments, tags | A state to watch is navy, not brass, which falls under 4.5:1 on its wash                                                                                                         |
| A missed visit            | No "What happened" log and no "Book again": the API keeps no such log, and booking stays where every visit is booked                                                             |
| Account                   | Keeps "Signed in on", the sessions                                                                                                                                               |
| Home                      | The card says the arrival, where and what it costs now; a covered visit reads "Paid", the API's one flag; prompts are rows; open issues a count; no last-visit thumbnail         |
| Home, a consultation      | Its third step is true of a consultation alone: nothing is fitted on the day                                                                                                     |
| Rewards                   | Choosing the card and agreeing to its photographs stay in the share sheet, where the consent is recorded before any card is made                                                 |
| Privacy and messages      | The first line keeps the words the booking records as the photographs' consent                                                                                                   |
| Address                   | A saved address shows as written, with Edit                                                                                                                                      |
| Notifications             | No "Mark all read": opening the inbox marks them read; a new one is a brass square, not a dot (square corners)                                                                   |
| Sign in                   | No example number as a placeholder                                                                                                                                               |
| The live card             | No "Also sent to you on WhatsApp": the app cannot know the client takes WhatsApp updates                                                                                         |
| Change                    | Two rows, Move and Cancel, under the visit's name and day; Add a note is the card's own button                                                                                   |
| Booking, day and time     | The days come a fortnight at a time with "Later dates", as the API gives them; a day inside the notice is not marked on the strip, the time chosen says so                       |
| Booking, the review       | The I-agree and reminder ticks stay; no free-visit switch, since the API applies it; no note box, since a note needs the visit; Back and Change only until Checkout has an order |
| Booking, booked           | Names the technician the API holds; no promise of a WhatsApp on a technician swap, which tells the client nothing (ruling 5)                                                     |
| Booking, the waits        | "This is taking longer than usual" for the design's "Waiting for your bank": the app cannot tell the two waits apart                                                             |

## 5. Owed by the owner, before the first live payment

From the brief's "Razorpay only", step 7, and `docs/open-points.md`:

- Live KYC cleared.
- The live Razorpay key ID, and `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` on production.
- The live webhook to `https://maneman.in/api/hooks/razorpay` with the nine events.
- Payment links on the live account.
- The CA's word on advances.
- A yes to item 13's plan, and which Books account receives Razorpay's money: "Razorpay", the account refunds leave
  from, or the company's bank account once it is linked.

A size no stock code matches needs nothing more from the owner: they ruled on 16 November that ops take it on
WhatsApp, and the app says so (section 2, item 5).

**The charges to review.** The late move or cancel charge and the no-show charge are set to Nothing in Settings ·
Rules, as they were while nothing was paid ahead. The app shows whatever is set; the owner should set them before
payments return.
