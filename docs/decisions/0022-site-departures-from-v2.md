# 0022. Where the site departs from v2 or the front-end prompt

- Status: accepted. The owner ruled on items 2, 4 and 5 on 22 September 2026.
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

12. **The WhatsApp number** is the business number the owner gave, +91 90079 73247, on every `wa.me` link and in the footer. The footer's phone number is still v2's placeholder, so it shows in staging and not in production.

13. **The privacy notice** was drafted from how the backend actually handles data, and the owner approved it with the three consent notices on 22 September 2026. It names the services that process data for Mane Man: Cloudflare, Zoho CRM, AILabTools and WhatsApp. The photo notice's "Shared with: Nobody outside Mane Man." row, approved as it stands, does not mention AILabTools. Counsel should reconcile the two.

14. **The terms** are still a placeholder, and production cannot publish without them.

15. **The Norwood fallback drawings.** Content can switch the Norwood cards to v2's line drawings (`_nwOld`) when the photographs are not cleared. v2 keeps each stage's bald region, but not the head drawing it was clipped to, so the fallback shows the regions alone. It needs a design pass before it is used.

16. **"Your photograph is deleted after thirty days."** v2 says this in three places. The backend keeps a photograph for an hour and a result for thirty days (staging: three), so the promise holds. The words are v2's.

## Tooling

17. **`openapi-typescript` and TypeScript 6.** The prompt generates the API types with `openapi-typescript`. Its latest release (7.13) declares a peer dependency on TypeScript 5, and the repository uses 6. A `package.json` override points it at the repository's TypeScript. It generates correctly, and `test/node/site-booking.test.ts` fails if the committed types drift from `docs/openapi.json`.

## The try-on (F3)

18. **The error screen.** v2 has one error screen, for a photograph that cannot be read. The prompt has `render_failed` and `busy` replace only its heading and body, and the site does the same for four kinds of error:
    - a photograph the browser, the API or the renderer cannot use: v2's words;
    - a failed render;
    - a busy service, which also covers the rate limits, a failed Turnstile check and an API that cannot be reached;
    - one look per visitor (`look_limit_reached`).

    v2's frame label ("Cannot read the photograph") and step label ("Cannot use this photograph") stay for every kind, though they blame the photograph for errors that are not its fault. **Raised for a design pass.** The one-look screen hides _Choose another_, since there is no second photograph to choose, and keeps _Book a visit instead_. The text is in `site.ts`.

19. **When an error shows.** A refused upload shows as soon as it happens, while the visitor is still choosing a stage or a look, rather than after Generate. A failed render shows during processing, on the gate, or on the result screen.

20. **The claim carries no Turnstile token.** The prompt puts Turnstile on every call that changes something, but the contract's `ClaimRequest` has no token field and the API would refuse one. The upload link, which starts every try-on, carries the token.

21. **The gate while it saves.** v2's gate has no sending state. The claim waits for the render to have started, which on a slow connection means waiting for the upload to finish, so the button reads _Saving_, with the booking form's sending icon, and ignores a second press. A refusal shows one line above the button, in the gate's error style:
    - a number that has had too many results today;
    - a result already saved to another number;
    - anything else.

22. **The result before the render is ready.** The gate opens at 20 seconds, and renders take 30 to 180, so the result screen often opens first. The after side then reads "Still working on it", in the gate's colours, and _Download_ and _WhatsApp_ wait until the image arrives. After five minutes the page gives up and shows the busy error. "A copy is on its way…" shows only when the API says messaging is on (`whatsapp_copy`).

23. **Download and WhatsApp.** _Download_ saves the result as a file. _WhatsApp_ shares the image through the phone's share sheet where the browser can share files. Elsewhere it opens WhatsApp with one line of text and no image: the result's link is private and expires, so it never goes in a URL.

24. **Back after Generate.** v2's back control from processing leads to the looks. With one look per visitor, Generate for the same look returns the render already running, and a different look is refused as `look_limit_reached`.

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

30. **The try-on countdown's contrast.** v2 draws the countdown in `#2A3A56` on `#0E1728`, a contrast of 1.6:1. That is under the 3:1 WCAG 2.2 AA asks of large text. The countdown is hidden from screen readers, which hear each finished step instead, but a sighted visitor with low vision may not read it. **Raised, not changed:** `#56678A` would reach 3.2:1. It is the one element the axe checks skip.
