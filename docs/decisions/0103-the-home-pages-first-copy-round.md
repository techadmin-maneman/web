# 0103. The home page's first copy round

- Status: accepted
- Date: 2026-10-01
- Amends [0022](0022-site-departures-from-v2.md), whose home page followed v2 word for word, and [0073](0073-prices-from-the-price-book.md), whose prices the site no longer shows. Records the owner's list of 1 October 2026 and the six rulings asked one at a time the same day, from the owner's product guide of 30 September 2026.

## Context

On 1 October 2026 the owner went through the home page and sent fifteen changes, with a standing rule for every word a client reads: tight and impactful, as a premium service should be; "hair system", never "hair patch"; and "100% real human hair" wherever the hair is described. With it came the product guide of 30 September 2026, which names the four constructions we fit, the materials and knots they use, and which life claims are still untested.

Six points needed a ruling before anything was built, and the owner made each the same day:

| #   | Question                                        | Ruling                                                                                                                                                                                                                                                                   |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | "Delivered in 90 minutes": the first fit is 180 | "Say 'in one visit'"                                                                                                                                                                                                                                                     |
| D2  | A fit at the consultation, or after it          | "Clients can choose one vs. two visits. If they choose consultation, the technician can measure and explain the product with the fit coming in later. If they choose consultation + fit, the technician can fit them their chosen product during the first visit itself" |
| D3  | Where a try-on's result is shown                | WhatsApp only, never on the site                                                                                                                                                                                                                                         |
| D4  | How hard the comparison is on the alternatives  | "Softer, no deaths": common, documented effects only                                                                                                                                                                                                                     |
| D5  | Where prices stop being shown                   | Everywhere                                                                                                                                                                                                                                                               |
| D6  | The photographs the list asks for               | "AI now, shoot later"                                                                                                                                                                                                                                                    |

## Decision

The list is built in four pull requests. This record covers the first, the words and the layout of the home page; the others are named at the end.

### The hero

Over the footage, "Undetectable. 100% Real Hair. At Home. Be the Main Man, Again." shows one phrase at a time, once, for 1.2 seconds each (`--duration-phrase`), and settles on the last: under five seconds, so it needs no control of its own (WCAG 2.2.2). The phrases share one grid cell, so the line keeps the height of the longest and nothing below it moves. A screen reader hears the whole line once, since every phrase stays in the page; reduced motion shows the last phrase alone, still. The headline is "Transformation and confidence, delivered in one visit." (D1), and the buttons are "Try a new look" and "Book a free consultation".

### The sections

- **What it is** is one paragraph, ending "…bonded to the skin. It is not a wig.", then "You sleep in it, shower in it, train in it." at the size of a section title. The base is described as the guide describes ours, lace, mono or skin, and no longer as a membrane "between three and twelve hundredths of a millimetre", since the thinnest is one we do not fit.
- **Why choose a hair system** replaces "Transplant, medication, or a system". "Slows the loss itself" and the note under the table are gone; a transplant's cost is "for just 4,000–5,000 hairs", its upkeep that the loss carries on and a second transplant often follows; and a row of side effects says what is common and documented (D4): infection, scarring and shock loss for a transplant, lower libido and scalp irritation for medication, and of a hair system only that nothing is implanted or swallowed, since its adhesive can irritate the skin. The hair system's cost is "Quoted at your free consultation" (D5).
- **How it works** opens with a free telephonic consultation, and its fit is "the same visit or a later one: your choice" (D2). Booking the two in one visit is not built yet (below).
- **The technicians** show only their years fitting and fits completed: the promise that the same man fits the first piece and comes every month is gone, and so are their notes, which leave the frozen placeholder list too (`site/src/content/design-placeholders.ts`).
- **The range** is new: Mane Man Essential, Active, Natural and NatMax, each with a line and what it is made of. They are the guide's Base, Active, Natural and Natural Plus under the owner's names.
- **Materials and construction** replaces "Two bases, two prices": six groups, the base materials, the knots, the rim and the hairline, the density, the hair and what we do not fit, each closed until it is opened and each opening on its own. Every figure is the guide's. No life in months is given for a base we fit, since the guide says none has been measured by us and marks the multi-layer base "Test before promising"; only the bases we do not fit are given theirs (`test/node/site/site-content.test.ts`).

### No prices

`PRICES_SHOWN` (`site/src/content/site.ts`) is off. The prices section is not rendered, the invite no longer lists or asks for prices, the business's structured data carries no `priceRange`, and every sentence that gave a price elsewhere now says the technician quotes it at the free consultation. The price book, the Worker's filling of prices and the price holes in the prices section stay as they were (ADR 0073), so turning the prices back on is this one constant, together with the tests that check they are absent, which fail until they are told otherwise. The terms now say "Prices are the ones we quote you before the fit", where they said the ones published on this site.

### The FAQ

The questions keep their number and order. Its answers lose what the guide contradicts or no longer holds: the "three hundredths of a millimetre" skin, which we do not fit; a life in months for each base; a hairline "agreed before the piece is ordered", where the piece may now be fitted the same day; and the first year's cost.

### What v2 no longer decides

v2 still decides the type, spacing and colour of every section it drew. The words above are the owner's, as are the order of the range and the materials after the technicians, and `npm run fidelity` pairs v2's bases with Materials and construction and its prices with nothing (`docs/fidelity-method.md`). The owner reviews these words again in a second round (`docs/open-points.md`, item 162).

## Still to build

- **The try-on's result on WhatsApp only (D3).** The number is asked for before the look is made, and the notices are redone with counsel (`docs/open-points.md`, item 146). Built 1 October 2026 ([0104](0104-the-try-ons-look-on-whatsapp-only.md)).
- **The photographs (D6).** One face through every stage, from the nose up; stages three to seven grouped, leading to one image of the fitted hair system; and an image under each of the comparison's three columns. Made with AI and marked as illustrations until a real shoot, which comes before production.
- **A consultation and fit in one visit (D2).** The client chooses the product before the visit, the slot is long enough for both, the fit is paid for at the visit and the technician carries the piece. Until then the site books the consultation as before, and the terms and `/book` still say nothing is fitted at it.

## Consequences

- The home page now says "in one visit" before the booking can offer one; the booking form still offers the consultation, then the fit (ADR 0086), until the fourth pull request.
- Search engines read no price range, and the home page's description names the service and the area rather than the hero's words, which no longer do.
