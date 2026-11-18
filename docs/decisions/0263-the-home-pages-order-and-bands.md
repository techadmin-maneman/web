# 0263. The home page's order and bands

- Status: accepted
- Date: 2026-11-17
- Topic: The site
- Amends [0213](0213-the-sites-second-copy-round.md) on the home page's order, and [0216](0216-the-sites-polish-pass.md)
  on how the comparison and the range draw on a phone

## Context

The approved prototype (`design/site-redesign/boards/Main.dc.html`, `LaptopHome.dc.html`) keeps the live home page's
words and sections but sets them on alternating grounds and changes four of them.

## Decision

1. **Order and grounds:** hero (navy film), results (white), what it is (cool), Norwood (white), comparison (cool),
   try-on teaser (navy), how it works (white), the range (cool), guarantee and founder (white), questions (cool),
   closing (navy), footer (navy, under a `navy-700` rule).
2. **The "at your own table" statement** is no longer a band of its own: it closes "How it works" under a 2 px navy
   rule. `DiscretionBand.astro` folds into `HowItWorks.astro`.
3. **Norwood on a phone** is a stage picker (III to VII, a segmented control named "Choose your stage") over two tiles:
   the chosen stage, and the restored hairline fixed beside it with its After and Illustration tags. Choosing a stage
   swaps only the left tile. A laptop keeps the one row.
4. **The comparison and the range on a phone** are toggles over key and value rows (Transplant or Medication against
   the hair system; Essential, Active, Natural or Celebrity), replacing the swipeable cards of ADR 0216. Each option's
   content is in the page, so without JavaScript the first shows and nothing is lost.
5. **The founder's note** shows its first paragraph; "Read the full note" opens the rest in place, a disclosure with
   `aria-expanded`. Every word stays in the page as written (the owner's ruling of 19 October 2026: the founder's words
   are never trimmed).
6. **Header and footer.** The header loses the "Delhi NCR" tag (it moves to the hero) and gains "Sign in", which opens
   the client app where it is switched on. The footer loses its Book button: the closing band above it is the last
   call.

## Consequences

- The picker and the two toggles are small Preact islands drawn from `packages/ui`'s segmented control, hydrated when
  visible.
- `e2e/home.e2e.ts` changes with the order and the phone's toggles; new tests cover the picker and the disclosure.
