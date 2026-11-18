# 0274. GST on: prices with their GST, and every invoice line and fee carrying its tax

- Status: accepted
- Date: 2026-11-18
- Topic: Money and Books
- Amends [0261](0261-razorpay-money-in-books.md) (the fee's GST), [0073](0073-prices-from-the-price-book.md) (how a
  price is set) and [0198](0198-cities-as-data.md) (which registration supplies a visit)

## Context

On 18 November 2026 the owner registered for GST and set it on in Books and Razorpay: GSTIN 07AAVCM6347C1Z5, in Delhi,
18%, with every price GST-inclusive. Read back the same day, nothing was right:

- Books refused every invoice the app raises, "Specify either a Tax or Tax Exemption" (400 code 110802): neither the
  line nor any item carried a tax. A kept charge's invoice the same.
- Every price in the book, staging's and production's, was at 0% GST, and the console took only a whole-rupee price
  before GST. A round price with 18% in it has no whole-rupee figure before GST (Rs. 32,000 is Rs. 27,118.64), and
  about one in seven whole-rupee prices has no figure in paise that GST adds back to it exactly (Rs. 2,000 is
  Rs. 1,694.92, which comes back as Rs. 2,000.01). A first fit's two parts each lost their paisa again.
- Books refused Razorpay's fee as an expense with a tax unless it named whose GST it was (400 code 113104, "Out of
  Scope").

Each was probed on the org with drafts made and deleted at once. With a tax on the line, Books worked out Rs. 32,000 as
Rs. 27,118.64 and IGST Rs. 4,881.36 in Haryana, or CGST and SGST of Rs. 2,440.68 each in Delhi.

## Decision

1. **A price is set as the client pays it.** `price_book.amount` and `city_prices.amount` (migration 0219) hold the
   price GST included; ops enter it in the console ("Price incl. GST, Rs.") with its GST rate, and the figure before GST
   is worked out from it and kept beside it, as before, for what reads that. Each row so far got the figure it already
   came to. A visit sold of parts adds what the client pays for each, at the GST of the first. A row with no `amount`,
   as one the Worker deployed before this adds, is worked out from the figure before GST, as before.
2. **Every invoice line carries its tax**, at the GST rate of the price it is sold at: the visit's price on its day; a
   kept charge's payment. Books' own tax is found by that rate, its list read once a run
   (`GET /settings/taxes`, `ZohoBooks.settings.READ`): the GST group of the rate, which Books splits as CGST and SGST,
   where the visit is in the state of the registration that supplies it; IGST at the rate across states. A rate Books
   has no tax for is a refusal, told to ops at once.
3. **With GST on, nothing is invoiced at no GST.** A visit whose price the book holds at 0% is held, and ops are told
   (`invoice_untaxed`) to set its price with its GST or raise it by hand; it is invoiced once it has one. A kept charge
   whose payment was taken with no GST in its price is told to ops to settle by hand.
4. **Razorpay's fee carries its GST once Razorpay's GSTIN is set.** `BOOKS_GATEWAY_GSTIN` and `BOOKS_GATEWAY_GST_STATE`,
   as Razorpay's tax invoice to us names them, replace `BOOKS_GATEWAY_FEES_TAX_ID`. The fee's rate is what Razorpay's
   own fee and tax come to, the GST group where Razorpay's state is ours, IGST otherwise, and the expense names
   Razorpay's GSTIN and both states, so the GST is input credit. Without them the whole fee is the expense.
5. **The registration is set:** `BOOKS_GSTIN` 07AAVCM6347C1Z5 and `BOOKS_GST_STATE` DL in staging and production.
   `BOOKS_SAC` waits for the CA.

## Consequences

- Visits in Gurgaon are supplied from the Delhi registration across a state line, so Books charges them IGST. The CA
  advised a registration in each state visited (docs/open-points.md, item 3); a Haryana registration, once there, is
  added in Settings › Cities and supplies them within the state.
- Staging writes into the one Books, now registered: its invoices, labelled "Staging test", are GST documents of the
  real GSTIN. The owner ruled on 18 November 2026 to keep the one organisation and clear it at go-live.
- A discount code still takes its figure off before GST, so a code on a round price leaves a figure in paise. A late
  fee's hold keeps its figure before GST, so at 18% one in seven may come a paisa off the price set.
- A supplier's bill from a registered supplier in India is refused by Books with GST on, as a receipt holds no GST of
  its own; an overseas supplier's is not. Out of this change (docs/open-points.md).
- The console's price API takes `amount`, not `amount_ex_gst`; a console tab open from before reloads to set a price.
