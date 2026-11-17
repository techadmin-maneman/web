# The site redesign: report

The public site rebuilt on the approved redesign (brief `docs/prompts/site-redesign.md`, plan `PLAN.md`, boards
`design/site-redesign/boards`, ADRs 0262–0266, 0269, 0272), in eight pull requests:

| PR  | What                                                            | Pull request |
| --- | --------------------------------------------------------------- | ------------ |
| 1   | Fidelity on the boards; tokens, Plex, the old fonts out         | #901         |
| 2   | Header, footer, sticky bar, slim footer, the laptop's flow bar  | #903         |
| 3   | Hero                                                            | #904         |
| 4   | Home sections 2 to 11, the bands, the picker and the toggles    | #906         |
| 5   | `/book` on the client app's parts, with the phone's flow frame  | #907         |
| 6   | `/try` on the client app's parts, with the phone's flow frame   | #909         |
| 7   | Guides, areas, the policies, notices, `/stop`, the 404          | #911         |
| 8   | 360, 768, 1024 px and 130% text; reduced motion; no paper; this | this one     |

## Boards and states

Every board is built. Each page was shot beside its board at 390 and 1440 px (`npm run fidelity`, pairs in
`docs/fidelity/site/`). The listed departures are the only differences left.

| Board                                         | Screens and states                                    | Built                                                                                         |
| --------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `Main` / `LaptopHome`                         | hero and sections 2 to 11, header, footer, sticky bar | Done (PRs 2–4)                                                                                |
| `PhoneBook` / `LaptopBook`                    | you, area, visit, address, not served, listed, booked | Done (PR 5); requested, taken, errors, offline, windows and invites drawn with the same parts |
| `PhoneTry` / `LaptopTry`                      | photo, check, look, send, sent, ready, error          | Done (PR 6); camera, blocked, no camera and every refusal drawn with the same parts           |
| `Guides`                                      | index, a guide                                        | Done (PR 7)                                                                                   |
| `Areas`                                       | index, a city                                         | Done (PR 7)                                                                                   |
| `Aftercare`, `Privacy`, `Terms`, `OfferTerms` | the policy                                            | Done (PR 7), with counsel's full text, not the boards' stubbed clauses                        |
| `Notices`                                     | the notices                                           | Done (PR 7)                                                                                   |
| `Stop`                                        | ask, done, visits stopped, expired, offline           | Done (PR 7)                                                                                   |
| `NotFound`                                    | the 404                                               | Done (PR 7)                                                                                   |

The referral landing (`/r/:code`) has no board; it shares `/book`'s island and look, and pairs against `/book`'s board
(`npm run fidelity:refer`).

## Assets

Every image and film is a file the site already had, through the same entry: the lockups
(`packages/brand/marks.ts`), the hero film and poster (`lib/hero-film.ts`), the four results pairs, the Norwood stages
and the restored head, the try-on teaser pair, How it works' three photographs, the try-on's looks and the guides'
photographs. Nothing was added to `site/src/assets`, and a test holds the set unchanged.

## Departures from the boards

1. **Phone comparison and range** are segmented toggles, as the prototype draws them, where live drew swipeable cards.
2. **The header's Book is an outline** everywhere, so each screen keeps one filled button (owner, 17 November;
   ADR 0266).
3. **Board stand-ins** are not built: one results pair, grey look thumbnails, guide photographs, "Prototype:" lines,
   stubbed clauses. The real content is.
4. **The one visit's length** reads as the console sets it; the board's "2.5 hours" shows only if ops set it.
5. **"10,000+ transformations"** is kept word for word: ADR 0213 records that it counts our specialists' past fits,
   and the owner confirmed it accurate on 17 November 2026.
6. **"Sign in" in production** is left out until the client app is switched on there.
7. **The home page's before and after pairs** keep their pre-redesign framing, at the owner's request: the results
   whole at 4:5, the try-on pair on the client's framing.
8. **A phone's address step** keeps its helper lines out of sight but read out.
9. **Every flow screen** says "Our Terms and Privacy Notice apply.", with both links, where the boards draw nothing
   (owner, 17 November).
10. **A button not usable yet** keeps the client app's pale look.
11. **A policy's clause numbers** keep counsel's form, "1.1." and "(a)".
12. **A row's chevron** is stone, the apps' chevron colour, where the boards draw a paler grey.
13. **A link in a policy's sentence** takes the sentence's colour, underlined in it.
14. **The way back above a guide or a city** reads the list's own title, "Guides" or "Areas we cover", where the boards
    write new words; it is a 44 px tap target.
15. **On a screen narrower than 357 px** with Sign in shown (279 px without it), as a small phone's or one with its text
    enlarged, the header draws the mark without the wordmark, and Sign in as its icon: a 44 px target, named for a
    screen reader.

## No paper

No page draws the brand's paper family or the client app's wash (`#E9E4D8`, `#F4F0E8` and their kin), at rest or
under the pointer, a full window on `/book` included (`e2e/site-look.e2e.ts`). The cookie bar's buttons, the
light-on-ink looks, a chosen card's words, a choice card's edge and a card that cannot be chosen, the focus ring over
a photograph or the camera's view, and the footer's icons now draw in roles the site sets to white, cool, stone, its
pale grey and brass (`--on-ink`, `--on-ink-pressed`, `--choice-edge`, `--choice-off`, `--focus-over-photo`); the
apps keep paper.

## Accessibility and sizes

- Every page and flow screen holds at 360, 768 and 1024 px and at 360 px with its text at 130%: nothing spills or
  scrolls sideways (`e2e/site-sizes.e2e.ts`). 390 and 1440 px are the browser tests' own widths.
- Under reduced motion nothing on any page moves on its own (`e2e/site-look.e2e.ts`); the hero's film waits for Play,
  and its turning line shows its last phrase, still. Save-Data gets the poster until Play
  (`e2e/home.e2e.ts`).
- Lighthouse, mobile profile, the median of three runs: home 98 / 100 / 100 / 100 (performance, accessibility, best
  practices, SEO), `/try` 99 / 100 / 100 / 100, `/book` 99 / 100 / 100 / 100, a guide, the cities and the privacy
  notice 100 across; every page within its budget (`npm run lighthouse`).

## Settled with the owner

- **The one visit's note**, "Paid through a Razorpay link once you're fitted. Decide against it and you pay nothing.",
  approved as written on 17 November 2026 (ADR 0269).
- **"10,000+ transformations"**: see departure 5.
- **The header's Book an outline, and the focus ring brass on every ground** (ADR 0266).
- **Razorpay only**, never UPI, on the site and in the client app (ADR 0272).
- **The terms and the privacy notice linked from every flow screen** (departure 9).

## Open for the owner

- **Visit lengths in the console** (first fit 90, service 60 minutes). The site reads them at build. The one visit's
  length follows the first fit's block (ADR 0105), so it reads 90 minutes unless ops give the one visit its own; the
  prototype shows 2.5 hours.
- **Production's coming-soon page** stays on until the redesign is released (`PRODUCTION_LIVE`).
- **Two button looks**, `goldOnNavy` and `outlineOnNavy`, which differ from `gold` and `outlineOnInk` only in navy and
  white words, as the no-paper ruling needs. Keep them, or fold them into the older looks.
- **The try-on teaser's slider handle.** The board draws none; the build keeps the shared square handle, which carries
  the keyboard's focus ring and on a phone sits over the face. Keep it, or move the ring to the whole slider.
- **UPI outside the site's copy.** The one visit and every visit are paid through Razorpay only (ADR 0272), and the
  site and the client app say so. Still naming UPI:
  - counsel's terms and privacy policy, among the ways to pay;
  - ADR 0209's mode with online payment off, where ops record a UPI payment taken at the visit, and its WhatsApp
    message (`visit_booked_at_visit_v1`) says "Pay … by UPI to Mane Man at the visit".
