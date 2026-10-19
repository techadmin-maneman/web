# 0216. The site's polish pass

- Status: accepted
- Date: 2026-10-19
- Topic: The site

## Context

The owner asked for a polish audit of the site and the client app, and raised five things of their own: the results
section broke on a laptop, one before and after pair was at two zoom levels, a compare's BEFORE and AFTER stayed in the
corners over the wrong picture, the footer looked unfinished and had no LinkedIn or Instagram, and the guarantee and the
founder's note were too much text. The audit found the rest: a page that lined up two ways on a laptop, step
photographs cut into bands, three and four columns squeezed onto a phone, "every month" beside Celebrity's twice a
month, and the shared controls' sizes missing on the site.

## Decision

1. **A compare's labels belong to their pictures.** Each label sits inside its own layer, so the divider wipes it away
   with its picture, and it fades as its picture narrows (`--at-n`). The divider leans once when the compare first comes
   into sight, unless motion is asked to stay still, and its handle is 48 px.
2. **One grid for the home page.** Every section sits on the page's container; the results put the heading, the line and
   the arrows beside the picture on a wide screen. Every section opens with the same gap.
3. **A comparison is cards on a phone.** Below 760 px the table gives way to a card for each option, the cards side by
   side to swipe through, each listing every row.
4. **The sticky bar is a phone's.** On a wider screen the header's own button books.
5. **One footer, on ink everywhere.** The brand, its line, the way to book, the number and the company's pages elsewhere
   beside two columns of links, then the company, its notices and the area. LinkedIn and Instagram show outside
   production only until their addresses are in (`socialLinks` in `site/src/content/site/contact.ts`).
6. **Photographs are framed whole.** The step photographs are 4:3 crops chosen for what each step shows; each guide but
   two has one of our own photographs beneath its lead, and a guide of four sections or more opens with a link to each.
7. **Fields carry no placeholder.** The labels name them; a hint inside a box read as something already typed.

## Consequences

- The guarantee and the founder's note stand side by side; the note keeps the founder's own words, as written.
- How it works says "Regular service visits", every month or every two weeks on Celebrity, on the home page and /book.
- The cities named on /areas still include one with no page of its own; which cities get pages is the owner's to say.
- Tests: `e2e/home.e2e.ts`, `e2e/try.e2e.ts`, `e2e/try-flow.e2e.ts`, `test/worker/site/site-worker-cities.test.ts`.
