# Redesign the Mane Man public site to the approved prototype, reusing every asset it already has

You are rebuilding the look of the public site (`site/`, `mm-site`) so it matches the approved prototype on a phone
and a laptop. This is front-end work. The site's content, assets, islands, API calls, notices, analytics, headers and
build gates stay. No endpoint, migration or setting changes. Where the prototype needs something the site does not
have, list it in your report; do not invent it.

## Inputs

1. `design/site-redesign/`: the approved prototype, 17 November 2026.
   - `boards/*.dc.html`: the 24 artboards (12 at 390 px, 12 at 1440 px), the same format as
     `design/Mane Man Site v2.dc.html`. Source of truth for layout, tokens, type, spacing and order. Their images
     point at the design tool's storage and do not load in the repo; `README.md` there maps every image to the file
     in `site/src/assets` or `design/brand` it stands for.
   - `screens/*.png`: 60 full-page renders with the real assets in place: every page at 390 and 1440 px, every
     `/book` step (you, area, visit, address with the WhatsApp code, not served, on the list, booked) and every `/try`
     step (photo, check, look, send, sent, ready, error).
   - The live canvas, clickable: https://claude.ai/artifact/XRXoLk736jQHLb2hVMqcfN
   Where the prototype and this brief disagree, the prototype wins on look and the brief wins on rules and words.
2. `docs/prompts/client-redesign.md` and ADRs 0252 to 0261. `/book` and `/try` must look and behave like the
   redesigned client app (revision 5). Its rulings bind here too, ruling 10 (square corners) and ruling 11 (Razorpay
   only, ADR 0257) above all.
3. `docs/site.md`, `docs/front-ends.md`, ADRs 0021, 0022, 0077, 0103, 0105, 0121, 0213, 0215, 0216.

## The owner's rulings (17 November 2026)

1. **The live site's words, word for word, everywhere.** The only new or changed strings are in "Copy changes"
   below. Every string stays in `site/src/content/`; components hold none.
2. **Reuse every existing asset.** Nothing is re-shot, re-cut, re-encoded, renamed or replaced. Section "Assets" maps
   each prototype image to the file that fills it. A new file in `site/src/assets` is a defect.
3. **IBM Plex Sans is the site's only typeface**, 400, 500 and 600, from `packages/brand/fonts-plex.css`, the files
   the apps already self-host. EB Garamond and Instrument Sans leave the site, the hero included. Keep the one-glyph
   rupee file only if Plex lacks ₹. ADR.
4. **No warm paper on screen.** The site's grounds are white `#FDFDFB` and a cool grey `#F1F3F6`, alternating, with
   navy bands. `paper` and `wash` (`#E9E4D8`, `#F4F0E8`) are print colours and appear nowhere on the site.
5. **One filled button per view**: navy on light grounds, gold on navy. Everything else is an outline or a text link.
   Gold appears nowhere else except the focus ring.
6. **The hero is the live hero**, restyled to Plex and aligned to the page column. Same film, phone cut, poster,
   overlays, turning lines, Pause and Play, and the same refusals (reduced motion, Save-Data, below 4G).
   "Book a free consultation" becomes the filled gold button and comes first; "Try a new look" is the outline beside
   or under it.
7. **Visit lengths come from the console, never from code.** The owner sets the first fit to 90 minutes and the
   service visit to 60 minutes in the console; the site's build reads them as today (`site/src/content/service.ts`,
   `scripts/lib/site-words.ts`) and writes them with `lengthWords`. A grep of `site/src` for a typed duration
   ("90 minutes", "3 hours", "60 minutes") finds only fixtures and tests.
8. **Before and after photos of consented clients stay**, labelled Before and After. The Norwood images and the
   restored hairline stay tagged Illustration.
9. **Square corners everywhere.** Circles only for radio dots, the spinner and the slider knob.

## Step 0: survey before you change anything

1. Read `docs/start-here.md`, `docs/site.md`, `docs/front-ends.md`, `docs/fidelity-method.md`, the ADRs above and
   `.claude/rules/`.
2. Inventory `site/src`: pages, home sections (`components/home/*`), header, footer, sticky bar, islands
   (`islands/invite/*`, `islands/tryon/*`, `ResultsGallery`, `BeforeAfter`), the `packages/ui` parts the islands use,
   and every token the site reads (`packages/brand/tokens.css`, `site/src/styles/tokens-site.css`).
3. Write `docs/site-redesign/PLAN.md`: each prototype board and state mapped to the page, component and content key
   that builds it; each asset mapped as in "Assets"; the token changes; the departures you expect and why. Write the
   ADRs (numbered from 0262) before the code they govern: the site's typeface and palette; the home page's new order
   and bands; the hero restyle; `/book` and `/try` on the client app's look. Commit the plan, then build.

## Non-negotiables

- **The site's existing rules hold**: every colour, size and space from the token files
  (`test/node/site/site-tokens.test.ts`); no `style` attribute and no `data:` URL (the CSP refuses both); no rupee
  figure typed into copy (`docs/site.md`, "Prices"); notices and their versions untouched; analytics events and what
  they carry untouched (ADR 0023); `?state=` previews keep working for every `/book` and `/try` state; Lighthouse
  budgets hold.
- **Accessibility**: 4.5:1 for text, 44 × 44 px targets, real buttons and links, `aria-pressed` on toggles,
  `aria-expanded` on disclosures, `aria-live` on the turning line, Pause and Play for anything that moves (WCAG
  2.2.2), nothing under 14 px on the home page, nothing under 13 px anywhere, layout intact at 360, 390, 768, 1024
  and 1440 px and at 130% text.
- **Fidelity**: `npm run fidelity` shot beside each board. A difference in type, spacing, colour or order is a
  defect (`docs/fidelity-method.md`). Point the tool at `design/site-redesign/boards` in the first PR.

## Tokens

| Token | Value | Use |
|---|---|---|
| `navy` | `#16233A` | Hero, try-on band, closing band, footer; titles; filled buttons on light grounds; table rules |
| `navy-700` | `#33435F` | Hairlines on navy; the rule between the closing band and the footer |
| `gold` | `#C9A363` | The one filled button on navy. Nothing else |
| `brass` | `#B98B45` | The focus ring only |
| `white` | `#FDFDFB` | Ground, and every second band |
| `cool` | `#F1F3F6` | The other bands; image placeholders; the highlighted column of the comparison table on white |
| `line` | `#D9DCE1` | Hairlines and borders on both light grounds |
| `ink` | `#1F2328` | Body text |
| `ink-500` | `#5F6670` | Secondary text |
| `mist` | `#A9B2C1` | Secondary text on navy; footer links |
| `film-scrim` | `#0B1220` at the live alphas | The hero's three overlays only |
| `red` / `red-wash` | `#A3361F` / `#FBF1EE` | Errors, as the client app |

- Hover: navy `#1F2E49`, gold `#D4B47A`. On-navy outline: white at 55%.
- **Type, phone to laptop** (clamp between the two):
  - hero turning line 40 to 80, 600, tracking -0.02em;
  - hero title 20 to 26, 500;
  - section title 26 to 44, 600;
  - statement 20 to 34, 600;
  - lead 16 to 18;
  - body 16;
  - labels and meta 14, 600 for labels;
  - buttons 16, 600.
- **Space**: page column 1200 px with 40 px gutters on a laptop, 20 px on a phone. Sections pad 56 px (phone) to
  96 px (laptop), top and bottom, inside their own band. Buttons 52 px; header buttons 40 (phone) and 44 (laptop).
- `/book` and `/try` take the client app's look file values (`docs/prompts/client-redesign.md`, "Design tokens") so
  the site and the app draw the same parts the same way (ADR 0121).

## Pages

### Header, footer, sticky bar

- **Header, phone**: lockup, "Sign in" (the client app, `site/src/lib/app-sign-in.ts`), "Free consultation" as the
  filled navy button. No menu.
- **Header, laptop**: lockup; What it is, The range, Questions; "Sign in"; "Book a free consultation" filled navy.
  The "Delhi NCR" text leaves the header (it moves to the hero).
- **Footer**: as live, minus its "Book a free consultation" button (the closing band above it is the last call).
  Navy, with a `navy-700` rule above it.
- **Sticky bar on phones**: as live (WhatsApp and Book), shown after the hero.

### Home, in this order and on these grounds

| # | Section | Ground | Notes |
|---|---|---|---|
| 1 | Hero | navy film | "Delhi NCR · home service" top left, Pause top right, both on the page column. Copy sits bottom left on the column. Book (gold, filled) then Try (outline). Phone: buttons full width, stacked |
| 2 | Results | white | Title left, before/after slider, caption, "n of 4", previous and next. All four `resultPairs`; the prototype shows one pair as a stand-in |
| 3 | What it is | cool | Body and the statement under a 2 px navy rule |
| 4 | Norwood | white | Laptop: the five stages and the restored hairline in one row, as now. **Phone: a stage picker** (III, IV, V, VI, VII as a segmented control) over two tiles side by side: the chosen stage on the left, the restored hairline fixed on the right with its After and Illustration tags and the `restored` line. Choosing a stage swaps only the left tile. Then the filled Book button |
| 5 | Comparison | cool | Header row as navy text over a 2 px navy rule, no filled header. The hair-system column picked out in white. Phone: the Transplant and Medication toggle, as now |
| 6 | Try-on teaser | navy | As live: label, title, body, slider, gold "Start the try-on" |
| 7 | How it works | white | Three steps with their photos. The "at your own table" statement closes the section under a 2 px navy rule; it is no longer a band of its own |
| 8 | The range | cool | Laptop: the table, header as in 5. Phone: the four-way toggle over key and value rows |
| 9 | Guarantee and founder | white | The founder's first paragraph shows; "Read the full note" opens the rest in place (a disclosure, not a new page) |
| 10 | Questions | cool | As live |
| 11 | Closing band | navy | As live; gold Book |

No two neighbouring sections share a ground.

### `/book` and `/try`

Rebuild both as the screens show, on the client app's parts, in every state the code has today (ADR 0081, 0116,
0118, 0217). The step order stays: name and mobile first (ADR 0116).

- **Phone `/book` is shorter than the laptop's.**
  - The page title shows on the first step only (the top bar says "Free consultation").
  - The intro is one line (see "Copy changes").
  - No "Step n · ..." labels: the step bar carries them.
  - "How it works" folds behind a disclosure, on the first step only.
  - On the visit step, one banner says the area is served and carries Change.
  - The address step drops the repeated name, area and "Your address" lines and the long helper lines.
  The laptop keeps the full intro, step labels and the How it works column.
- **The one visit** ("Consultation and fit", ADR 0105) shows the first fit's length as the API gives it, with the
  fit note in "Copy changes".
- **Done** keeps the calendar links (Google Calendar, Apple or Outlook) and "Open the app".

### Guides, areas, aftercare, privacy, terms, notices, offer terms, stop, 404

- The boards show the restyle: the slim header and footer, a 2 px navy rule over each title, Plex, and the new
  tokens. Words and structure stay as live.
- The terms and privacy boards stub some clauses with a "Prototype:" line. Build the full live text.

## Assets

Every image and film is already in the repo. Reuse it through the content entry that names it today.

| Prototype slot | Content entry (`site/src/content/site/media.ts` unless named) | Files |
|---|---|---|
| Lockup, header and footer | `design/brand` via `packages/brand/marks.ts` | `lockup-navy.svg`, `lockup-white.svg` |
| Hero film | `heroFootage` and `lib/hero-film.ts` | `fit-film.mp4`, `fit-film-phone.mp4`, `fit-film-poster.jpg` |
| Results slider | `resultPairs`, `islands/ResultsGallery.tsx`, `islands/BeforeAfter.tsx` | `result-1..4-before.jpg`, `result-1..4-after.jpg` |
| Norwood stages | `norwoodPhotos` | `norwood-3.jpg` to `norwood-7.jpg` |
| Restored hairline | `norwoodRestored` | `norwood-restored.jpg` |
| Try-on teaser | `teaserPair` | `tryon-before.jpg`, `tryon-after.jpg` |
| How it works | `stepPhotos` | `step-consultation.jpg`, `step-first-fit.jpg`, `step-service.jpg` |
| Founder's note | `founderNote` | none |
| `/try` looks | `src/config/presets.ts` order, `lib/look-thumbnails.ts` | `look-*.jpg` |
| Guides | `content/guides.ts` | `guide-*.jpg` |
| Icons | `packages/brand/icons.ts` | none |

## Copy changes

The only new or changed strings, each a new key beside its section's in `site/src/content/`:

1. Hero: "{serviceArea} · home service", top left.
2. Founder's note: "Read the full note".
3. Norwood picker: the group's label "Choose your stage"; each option's name "Stage {numeral}, {name}". The tiles use
   the existing stage names, "We fit", `results.after` and `illustrationTag`.
4. Phone `/book`, first step: "{visitLength.consultation} at your home, completely free." The laptop keeps both live
   paragraphs.
5. `/book`, the one visit's note. The prototype's "Pay by UPI once fitted" contradicts ADR 0257 and must not ship. Use
   ADR 0105's terms in 0257's way: "Paid through a Razorpay link once you're fitted. Decide against it and you pay
   nothing." Mark it `PLACEHOLDER` for the owner's wording, so production's build names it (`scripts/lib/content-gate.ts`).
6. Durations everywhere ("90 minutes at your own table", "From these to this in 90 minutes.", each step's meta) are
   the live sentences with the console's length, not new strings.

## Delivery

1. Step 0, then `PLAN.md` and the ADRs, committed.
2. Build in this order, one PR each, nothing pushed before its review:
   1. design export wired to fidelity; tokens (palette, Plex, type and space scale); fonts out
   2. header, footer, sticky bar, slim header and footer
   3. hero
   4. home sections 2 to 11, with the bands
   5. `/book` on the client app's parts, phone and laptop
   6. `/try` on the client app's parts, phone and laptop
   7. guides, areas and the text pages
   8. 360 px, 768 px, 130% text, reduced motion and Save-Data pass; Lighthouse
3. **Every PR follows `.claude/rules/review-before-push.md` exactly.**
   - Screenshot every touched page at 360, 390 and 1440 px.
   - `ui-guard` gets `design/site-redesign/boards` as the design file. `reviewer` gets this brief and `PLAN.md`.
   - Record each verdict with `node .claude/hooks/review-gate.mjs record`.
   - Never `--no-verify`.
4. Run the existing suites (`npm test`, the site's Playwright projects at 390 and 1440, `npm run check:site`,
   `npm run fidelity`, `npm run lighthouse`) and add tests for the Norwood picker, the founder's disclosure, the hero's
   Pause with the film, and the phone `/book` disclosures.
5. Add this brief's row to `docs/prompts/README.md`.
6. **Final report** in `docs/site-redesign/REPORT.md`:
   - each board and state, done or not;
   - each asset, reused from where;
   - every departure from the prototype, and why;
   - the owner's open items: the console lengths set (first fit 90, service 60); the one visit's length, which ADR
     0105 ties to the first fit's block, so it reads 90 minutes once the first fit is 90 unless ops give the one visit
     its own (the prototype shows 2.5 hours); the one-visit note's wording; the "10,000+ transformations" claim, which
     has no source in the repo.

## Acceptance

- Each page matches its board at 390 and 1440 px in layout, tokens, type and words, with square corners, and holds at
  360, 768 and 1024 px and at 130% text.
- Plex is the only typeface the site loads; no page draws `#E9E4D8` or `#F4F0E8`.
- Every image and film the site shows is a file that was already in the repo; the build adds none.
- No typed visit length, price or rule value in `site/src` outside tests; changing a length in the console changes
  the site at the next build.
- Each view has one filled button, navy on light, gold on navy.
- `/book` and `/try` reach every state they reach today, and look like the client app's same parts.
- No copy offers paying by UPI or cash.
- All three reviewers PASS on every PR.
