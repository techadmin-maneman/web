# 0022. Where the site departs from v2 or the front-end prompt

- Status: accepted. The owner ruled on items 2, 4 and 5 on 22 September 2026. Amended by [ADR 0104](0104-the-try-ons-look-on-whatsapp-only.md) on 1 October 2026: the try-on's look goes to WhatsApp only (items 18, 19, 21 to 24, 30, 32, 33 and 38).
- Date: 2026-09-22

## Context

The prompt's rule: where v2 and the API contract disagree, the contract wins on data and v2 on everything visible. A conflict is recorded here, and anything in v2 that looks wrong is raised rather than changed. The fidelity pairs in `docs/fidelity/` show each visible difference.

## The contract over v2

1. **The photo goes to the API, not to R2.** The prompt has the browser `PUT` the photo to a presigned R2 URL. The backend decided otherwise (ADR 0014): `POST /api/tryon/upload-url` returns a same-origin `upload_url`, and the browser `PUT`s the photo there. F3 follows the API, and F4's content security policy needs no R2 endpoint.

2. **One look per visitor.** The owner decided that each visitor gets one look (ADR 0018), and the API refuses a second with `403 look_limit_reached`. v2 promised more. **Ruling: change the copy, one look per visitor.**
   - The teaser's "One photograph, six looks." now reads "One photograph, one look from six."
   - The looks screen's "Six to choose from. You can try the others afterwards." now reads "Six to choose from, and one simulation each, so choose the one you would wear."
   - The result screen's "Try another look" is gone, so the result has three actions.

3. **The booking form's data.**
   - The lead request carries no notice version: the API records the booking notice's current version itself.
   - The API proposes no day when every day in reach is blacked out. The booked screen then reads "Your measurement is booked." and offers no calendar file.
   - The booked rows show the number the visitor typed, since the answer carries none.

## Where v2's own rendering is a slip

4. **Item 7, "the full-bleed hair texture band".** v2 has no such band, and its `hair-texture.jpg` is never used. The only full-bleed band is the membrane photograph that opens "What it is", so that is item 7.

5. **The booking page's stray `</div>`.** At lines 902–906, v2 closes the form's two-column grid, and then its padded container, too early. **Ruling: match v2 as it renders.**
   - The intro sits above the form card, with no gap between them.
   - The booked and waitlist screens sit after the page's padding, against the screen's left edge.

6. **The bases drawing's labels.** v2's template labels each drawing ("Hand-tied knots" and "Mesh base", or "V-looped, no knots" and "Thin skin"), but its runtime drops those text holes, so only "Scalp" shows, and in the drawing's navy outline. **Ruling: keep the three labels the template asks for**, in muted small caps, without the outline.

## Rules from the prompt that change what v2 shows

7. **The footer's wordmark.** The prompt picks the wordmark's cut by width: the small cut below 112 px, the display cut from 112 px. The footer's wordmark is 132 px wide, so it is the display cut; v2 draws the small cut. The header's, at 96 px, stays the small cut.

8. **Focus rings.** v2 draws none. Every control shows one, in the ground's text colour, as WCAG 2.2 requires. The inputs keep v2's look and put the ring on their box.

9. **The privacy link on `/try`.** The consent sentence is v2's word for word, with "privacy notice" linking to `/privacy`. It is underlined, faintly: a link in the same colour as its sentence, with no underline, could not be seen.

10. **Refusals from the API.** v2 has no words for a booking the API turns away. Each shows one line above the button, in the form's error style:
    - too many requests from the number;
    - a failed Turnstile check;
    - anything else;
    - and a city list that did not load.

    The text is in `site.ts`.

11. **Turnstile.** The managed widget renders with `appearance: "interaction-only"`, above the button. It is invisible unless Cloudflare needs the visitor to act.

## Content

12. **The WhatsApp number** is the business number the owner gave, +91 90079 73247, on every `wa.me` link and in the footer. The footer's phone number is the same line, +91 90079 73247, as the owner gave it on 22 September 2026.

13. **The privacy notice** was drafted from how the backend actually handles data, and the owner approved it with the three consent notices on 22 September 2026. It names the services that process data for Mane Man: Cloudflare, Zoho CRM, AILabTools and WhatsApp. The photo notice's "Shared with: Nobody outside Mane Man." row does not mention AILabTools. The owner confirmed on 22 September 2026 that legal has checked the two together and approves both as they stand.

14. **The terms** were drafted from what the site already publishes: the free measurement, the prices and payment, the fourteen-day guarantee and the try-on's rules. They add the few things terms need: the eighteen-or-over rule for the try-on, the limit of liability, and Indian law with the courts at New Delhi. The owner approved them on 22 September 2026. With them, the production build passes the publish gate.

15. **The Norwood fallback drawings.** Content can switch the Norwood cards to v2's line drawings (`_nwOld`) when the photographs are not cleared. v2 keeps each stage's bald region, but not the head drawing it was clipped to, so the fallback shows the regions alone. It needs a design pass before it is used.

16. **"Your photograph is deleted after thirty days."** v2 says this in three places. The backend keeps a photograph for an hour and a result for fourteen days in production (ADR 0039; staging: three), so the promise holds. The words are v2's. The result screen's "A copy is on its way to … Deleted after thirty days." spoke of the simulation, which the privacy notice keeps for fourteen days, so it reads "Deleted after fourteen days." (25 September 2026).

## Tooling

17. **`openapi-typescript` and TypeScript 6.** The prompt generates the API types with `openapi-typescript`. Its latest release (7.13) declares a peer dependency on TypeScript 5, and the repository uses 6. A `package.json` override points it at the repository's TypeScript. It generates correctly, and `test/node/site-booking.test.ts` fails if the committed types drift from `docs/openapi.json`.

## The try-on (F3)

18. **The error screen.** v2 has one error screen, for a photograph that cannot be read. The prompt has `render_failed` and `busy` replace its heading and body, and the site uses the screen for four kinds of error:
    - a photograph the browser, the API or the renderer cannot use: v2's words;
    - a failed render;
    - a busy service, which also covers the rate limits, a failed Turnstile check and an API that cannot be reached;
    - one look per visitor, now only when that look can no longer be shown (33).

    v2's step label ("Cannot use this photograph") and frame label ("Cannot read the photograph") blamed the photograph for every kind. **The owner ruled on 22 September 2026 that they must not:** each kind now has its own step label, frame label, heading and body, and only the photograph's are v2's. The one-look screen has no _Choose another_. The text is in `site.ts`. **Changed 1 October 2026 ([ADR 0104](0104-the-try-ons-look-on-whatsapp-only.md)):** a browser that has had its look is told it was sent, on the sent screen, so the one-look kind is gone; its place is taken by the try-on not available while WhatsApp cannot send a look, which has no _Choose another_ either.

19. **When an error shows.** A refused upload shows as soon as it happens, while the visitor is still choosing a stage or a look, rather than after Generate. A failed render shows during processing, on the gate, or on the result screen. **Since 1 October 2026 (ADR 0104)** the render starts after the gate, so a failed render shows on the sent screen.

20. **The claim carries no Turnstile token.** The prompt puts Turnstile on every call that changes something, but the contract's `ClaimRequest` has no token field and the API would refuse one. The upload link, which starts every try-on, carries the token.

21. **The gate while it saves.** v2's gate has no sending state. The claim waits for the render to have started, which on a slow connection means waiting for the upload to finish, so the button reads _Saving_, with the booking form's sending icon, and ignores a second press. A refusal shows one line above the button, in the gate's error style:
    - a number that has had too many results today;
    - a result already saved to another number;
    - anything else.

    **Changed 1 October 2026 (ADR 0104):** the gate comes before the render, so the button waits for the upload, then the claim and the render's request, and reads _Sending_; its lines speak of looks.

22. **The result before the render is ready.** The gate opens at 20 seconds, and renders take 30 to 180, so the result screen often opens first. The after side then reads "Still working on it", in the gate's colours, and _Download_ and _WhatsApp_ wait until the image arrives. After five minutes the page gives up and shows the busy error. "A copy is on its way…" shows only when the API says messaging is on (`whatsapp_copy`). **Superseded 1 October 2026 by ADR 0104:** there is no result screen; the look goes to WhatsApp only, and the sent screen says so.

23. **Download and WhatsApp.** _Download_ saves the result as a file. _WhatsApp_ shares the image through the phone's share sheet where the browser can share files. Elsewhere it opens WhatsApp with one line of text and no image: the result's link is private and expires, so it never goes in a URL. **Superseded 1 October 2026 by ADR 0104:** the page never holds the look, so it offers neither.

24. **Back after Generate.** v2's back control from processing leads to the looks. With one look per visitor, Generate for the same look returns the render already running, and a different look is refused as `look_limit_reached`. **Since 25 September 2026** the looks screen, reached back from processing or the gate, shows the chosen look fixed and the others unavailable, with a line saying why and Continue in place of Generate, which returns to the gate: a visitor who picked another look used to land on "The look you had." with the gate, and their number, lost. A new photograph unfixes it, and asks for the photograph's agreement afresh. **Superseded 1 October 2026 by ADR 0104:** nothing renders before the gate, so there is no processing screen, and back from the gate the looks are all open.

25. **The photograph.** It is prepared as the AILabTools harness prepares it:
    - fitted within 4090 px;
    - re-encoded as JPEG at 0.92, which drops its EXIF, the location included;
    - shrunk by 15% at a time until it is under 5 MB.

    A file the browser cannot read, or one under 200 px on a side, goes straight to the error screen, and nothing is sent. The hair colour comes from the harness's detector, run in the browser. A shade the API does not accept, such as blonde or red, is sent as `unknown`.

## Launch hardening (F4)

26. **The hero footage starts once the page has loaded.** v2 plays it at once. Waiting keeps its 2.3 MB download from slowing the poster, which is the largest thing painted first (ADR 0023, 4). The poster shows until then.

27. **₹ comes from a one-glyph font file.** EB Garamond's ₹ is cut into a 768-byte file, so the page no longer downloads the whole latin-ext subset for it. Instrument Sans has no ₹ in any subset, the design's copy included, so its ₹ was already the system font's. Nothing looks different: the fidelity pairs are unchanged.

28. **The shared-link card.** v2 has none. The card is the brand kit's gilt lockup on ink, 1200 × 630.

29. **The address is tidied on arrival.** A link carrying query parameters other than campaign tags loses them from the address bar before any analytics tag reads it. The campaign tags stay, as do the preview switches outside production.

30. **The try-on countdown's contrast.** v2 draws the countdown in `#2A3A56` on `#0E1728`, a contrast of 1.6:1. That is under the 3:1 WCAG 2.2 AA asks of large text. The countdown is hidden from screen readers, which hear each finished step instead, but a sighted visitor with low vision may not read it. **Raised, not changed:** `#56678A` would reach 3.2:1. It is the one element the axe checks skip. **Changed 25 September 2026:** the countdown is drawn in `--ink-line-strong` (#6B7B95), 4.2:1, a colour the site already has rather than a new one, and axe no longer skips it (ADR 0022, item 37). **Since 1 October 2026 (ADR 0104)** there is no countdown: nothing renders before the gate.

31. **The hair-colour detector reads some portraits as `unknown`.** The owner's own straight-on photograph, dark hair on a white background above a black suit, reads as `unknown`, and so is rendered black, which suits it. The detector is the harness's, unchanged:
    - thinning hair over the scalp reads as skin, so the head box starts too high;
    - a plain background makes the crown sample look flat;
    - a black suit counts as scenery, which takes black hair out of the sample.

    The render comes out right for dark hair, since `unknown` goes to `pro_black`. It would be wrong for grey or white hair in a photograph like it. **Raised:** improving the detector means departing from the harness.

## The owner's review of staging (22 September 2026)

32. **The number at the gate is optional.** The gate's approved copy says the result opens "either way", but v2's form required the name and the number. **Ruling: the copy wins.** Both fields left empty open the result; either one filled in needs both, and the claim then saves the lead and sends the WhatsApp copy. The API change behind it is in ADR 0024. **Reversed 1 October 2026 by the owner's ruling D3 (ADR 0104):** the look goes to WhatsApp only, so both fields are needed, as v2's form had them, and the gate's notice (`gate-v3`) says so.

33. **A returning visitor sees their look.** v2 has no such screen: a second photograph ended on "You have had your look." Now the page shows the first look again, on the result screen, as the result alone, since the photograph is not kept. The title is "The look you had." with a line saying each visitor gets one simulation. Download and WhatsApp work as usual. The error screen appears only once that look has expired. **Superseded 1 October 2026 by ADR 0104:** a returning visitor is told "Your look has already been sent.", on the sent screen, without the look, whether or not it is still kept.

34. **The Norwood scale's late stages start at the left edge.** v2 centres stages III to VII, and on a phone leaves VII alone in the middle of its row. **Ruling: align them.** The late cards are a grid from the left edge, at v2's card size. Each row of cards shares one title height (CSS subgrid), so the descriptions start level however the titles wrap.

35. **How it works: the text starts at the top of the number.** v2 sits each title on the baseline of its large number, so the text starts below the number's top. **Ruling: top-align.** The title's capitals now line up with the number's, trimmed with `text-box`, which Chrome and Safari support. Other browsers align the two boxes, a few pixels apart.

## Phase 2's rulings (22 September 2026)

36. **"Consultation", and an evening of 4 to 8.** v2 names the first visit a "measurement" and offers evenings "after six". Phase 2 names it a consultation and offers evenings from 4 to 8 pm, and the owner ruled that Phase 2 wins. Every place the site names the visit, the booked page's headline and the calendar file follow (ADR 0040). The verb "measures" stays where the copy says what happens at the visit.

## WCAG 2.2 where the designs fall short (25 September 2026)

37. **Where the site departs from v2 and the Referral and Waitlist boards for WCAG 2.2 AA.** Taken 25 September 2026, for the owner to see, as the client app's are (ADR 0025, item 36):
    - **A field's and a checkbox's edge.** The boards edge them in `--paper-line` (#CEC6B4), 1.7:1 against white, and on ink in `--ink-line` (#3A4A64), 1.75:1 against the pincode block and 2.0:1 against the try-on: under the 3:1 that WCAG 1.4.11 asks of the boundary that shows where to type or what is ticked. They are drawn in the client app's `--paper-control` (#8A8173, 3.8:1 on white) and `--ink-line-strong` (#6B7B95, 3.7:1 on the ink, 4.2:1 on the try-on's). The date and window cells, which carry their own words and turn ink when chosen, keep the design's lines, as the app's date strip does. The required agreement's box is edged in ink, as C2 and C3 draw it.
    - **Placeholders** are `--paper-hint` (#756D60, 5.1:1 on white), where v2's `--paper-placeholder` (#9A9284) is 3.1:1, under the 4.5:1 WCAG 1.4.3 asks of text.
    - **Keyboard focus on the drawn controls.** The booking form's dates, windows, extents and checkboxes are hidden inputs drawn as cells and boxes, so the ring is drawn on the cell or the box, as the try-on's choices already were (WCAG 2.4.7). A heading the page focuses to say where a step has moved to draws no ring: it is not a control.
    - **Nothing the keyboard reaches sits under a fixed bar.** The page scrolls a focused control clear of the header, and on the home page clear of the sticky bar (WCAG 2.4.11).

38. **The try-on's result frame takes the photograph's shape at every width.** v2 draws the result in a frame as wide as its column. Since the frame took the photograph's own shape (23 September 2026), a portrait photograph taller than the frame's cap was letterboxed at 1440, with bands either side. The frame now narrows to keep the photograph's shape once it reaches the cap, so it is never letterboxed and never cropped; it is narrower than v2's column for a portrait photograph. The home page's teaser, which shows the design's own pair in a fixed band, fills it as v2 does. **Superseded 1 October 2026 by ADR 0104:** the site shows no result, so the frame is gone.

39. **Prices are the price book's.** v2 publishes ₹25,000, ₹1,500 and ₹17,000 for the standard tier, with first-year totals and a price range typed beside them. **Ruling (ADR 0025, item 13): prices come from the price book.** The standard column, the comparison, the fourth step, the bases, the first-year example, the FAQ's answer and the search engines' price range show the book's figures before GST, written in by mm-site's Worker, and the totals are computed: ₹30,000, ₹2,000 and ₹15,000 on 26 September 2026, a first year of ₹54,000. Premium keeps v2's figures until the owner rules on the tier (ADR 0025, item 35; ADR 0073).
