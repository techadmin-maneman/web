# 0274. GST on: prices with their GST, and every invoice line and fee carrying its tax

- Status: accepted
- Date: 2026-11-18
- Topic: Money and Books
- Amends [0261](0261-razorpay-money-in-books.md) (the fee's GST), [0073](0073-prices-from-the-price-book.md) (how a
  price is set), [0198](0198-cities-as-data.md) (which registration supplies a visit) and the discount codes' GST

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

Each was probed on the org with drafts made and deleted at once. With a tax on the line, Books keeps an inclusive line's
total to the paisa, moving the figure before tax instead: Rs. 2,200 within Delhi is Rs. 1,864.40 and CGST and SGST of
Rs. 167.80 each; across into Haryana, Rs. 1,864.41 and IGST Rs. 335.59. A line's discount it takes as a figure before
tax and adds the tax to: Rs. 2,547 less a discount of Rs. 382 came to Rs. 2,096.24, Rs. 2,547 less Rs. 450.76.

## Decision

1. **A price is set as the client pays it.** `price_book.amount_paise` and `city_prices.amount_paise` (migration 0220)
   hold the price GST included; ops enter it in the console ("Price incl. GST, Rs.") with its GST rate, and the figure
   before GST is worked out from it and kept beside it, as before, for what reads that. Each row so far got the figure
   it already came to. A row's figure is trusted only while the figure before GST still comes from it, so a row the
   Worker deployed before this adds, or changes, is read from the figure before GST, as before. A visit sold of parts
   adds what the client pays for each, at the GST of the first.
2. **A discount code takes its figure off with its GST.** A code's figure stays one before GST, in whole rupees; off a
   price that carries what the client pays, it takes that figure with its GST added, as Books does, so the hold, the
   payment and Books' invoice agree to the paisa, and the code taken off again gives back the price as set. With a tax
   on the line, the invoice names the code's figure before GST as its discount where that comes to what was paid: a
   code in whole rupees at the price's own GST. Otherwise, as for a code worth the whole price or a visit charged a GST
   its day's price had not (decision 4), the line is what was paid with no discount, which Books keeps to the paisa.
   Without a tax on the line, the discount is what came off the price.
3. **Every invoice line carries its tax**, at the GST rate of the price it is sold at: the visit's price on its day; a
   kept charge's payment. Books' own tax is found by that rate, its list read once a run
   (`GET /settings/taxes`, `ZohoBooks.settings.READ`): the GST group of the rate, which Books splits as CGST and SGST,
   where the visit is in the state of the registration it is invoiced under; IGST at the rate across states. A visit is
   invoiced under its state's own registration only where that one names a Books branch; else under the one in
   `BOOKS_GSTIN`. A rate Books has no tax for is a refusal, told to ops at once.
4. **With GST on, nothing is invoiced at no GST.** A visit whose price on its day had none is charged the GST of its
   price as it stands now (a first fit's hair system's, a replacement's replacement's), at what it was sold for; while
   that has none either, it is held and ops are told (`invoice_untaxed`) to set that price with its GST, from tomorrow,
   after which it is invoiced. A kept charge
   whose payment was taken with no GST in its price is told to ops to settle by hand.
5. **Razorpay's fee carries its GST once Razorpay's GSTIN is set.** `BOOKS_GATEWAY_GSTIN` and `BOOKS_GATEWAY_GST_STATE`,
   as Razorpay's tax invoice to us names them, replace `BOOKS_GATEWAY_FEES_TAX_ID`. The fee's rate is what Razorpay's
   own fee and tax come to, the GST group where Razorpay's state is ours, IGST otherwise, and the expense names
   Razorpay's GSTIN and both states, so the GST is input credit. Without them the whole fee is the expense.
6. **The registration is set:** `BOOKS_GSTIN` 07AAVCM6347C1Z5 and `BOOKS_GST_STATE` DL in staging and production.
   `BOOKS_SAC` waits for the CA.

## Consequences

- Visits in Gurgaon are supplied from the Delhi registration across a state line, so Books charges them IGST. The CA
  advised a registration in each state visited (docs/open-points.md, item 3); a Haryana registration, once there, is
  added in Settings › Cities with its Books branch and supplies them within the state.
- Staging writes into the one Books, now registered: its invoices, labelled "Staging test", are GST documents of the
  real GSTIN. The owner ruled on 18 November 2026 to keep the one organisation and clear it at go-live.
- A code's figure with its GST is often not a round number, so a price with a code on it can end in paise. A code worth
  the whole price, taken off a hold again, may bring the price back a paisa off, and that visit's invoice is then held
  as a draft for ops. A late fee's hold keeps its figure before
  GST, so at 18% one in seven may come a paisa off the price set.
- Visits held for want of GST take the invoice pass's places each hour until their service is priced with it.
- A supplier's bill from a registered supplier in India is refused by Books with GST on, as a receipt holds no GST of
  its own; an overseas supplier's is not. Out of this change (docs/open-points.md).
- The console's price API takes `amount`, not `amount_ex_gst`; a console tab open from before reloads to set a price.
