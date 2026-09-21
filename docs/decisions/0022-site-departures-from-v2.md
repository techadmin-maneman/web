# 0022. Where the site departs from v2 or the front-end prompt

- Status: accepted, with items 2, 4 and 5 awaiting the owner's ruling
- Date: 2026-09-22

## Context

The prompt's rule: where v2 and the API contract disagree, the contract wins on data and v2 on everything visible. A conflict is recorded here, and anything in v2 that looks wrong is raised rather than changed. The fidelity pairs in `docs/fidelity/` show each visible difference.

## The contract over v2

1. **The photo goes to the API, not to R2.** The prompt has the browser `PUT` the photo to a presigned R2 URL. The backend decided otherwise (ADR 0014): `POST /api/tryon/upload-url` returns a same-origin `upload_url`, and the browser `PUT`s the photo there. F3 follows the API, and F4's content security policy needs no R2 endpoint.

2. **One look per visitor.** The owner decided that each visitor gets one look (ADR 0018), and the API refuses a second with `403 look_limit_reached`. v2 still promises more in three places:
   - "One photograph, six looks." in the teaser;
   - "Six to choose from. You can try the others afterwards." on the looks screen;
   - the "Try another look" control on the result screen.

   F1 builds v2's words and control, since they are visible. **The owner rules on them before F3 wires the API.**

## Where v2's own rendering is a slip

3. **Item 7, "the full-bleed hair texture band".** v2 has no such band, and its `hair-texture.jpg` is never used. The only full-bleed band is the membrane photograph that opens "What it is", so that is item 7.

4. **The booking page's stray `</div>`.** At lines 902–906, v2 closes the form's two-column grid, and then its padded container, too early.
   - v2 renders the form card under the intro, not beside it.
   - It renders the booked and waitlist screens flush against the left edge of the screen, outside the page's padding.

   The build follows the markup as written: the two columns, and the padding. **The owner chooses.** Matching the render instead is a one-line change for each.

5. **The bases drawing's labels.** v2's template labels each drawing ("Hand-tied knots" and "Mesh base", or "V-looped, no knots" and "Thin skin"), but its runtime drops those text holes, so only "Scalp" shows. And "Scalp" inherits the drawing's navy outline, which makes it look bold. The build shows the three labels the template asks for, in muted small caps, without the outline. **The owner chooses.**

## Rules from the prompt that change what v2 shows

6. **The footer's wordmark.** The prompt picks the wordmark's cut by width: the small cut below 112 px, the display cut from 112 px. The footer's wordmark is 132 px wide, so it is the display cut; v2 draws the small cut. The header's, at 96 px, stays the small cut.

7. **Focus rings.** v2 draws none. Every control shows one, in the ground's text colour, as WCAG 2.2 requires. The inputs keep v2's look and put the ring on their box.

8. **The privacy link on `/try`.** The consent sentence is v2's word for word, with "privacy notice" linking to `/privacy`. It is underlined, faintly: a link in the same colour as its sentence, with no underline, could not be seen.

## Content that is not ready

9. **The WhatsApp number.** Every `wa.me` link uses the footer's WhatsApp number, which is a placeholder, so staging's links reach a stand-in number. Production cannot publish until the real business number replaces it: the publish gate knows the placeholder.

10. **The Norwood fallback drawings.** Content can switch the Norwood cards to v2's line drawings (`_nwOld`) when the photographs are not cleared. v2 keeps each stage's bald region, but not the head drawing it was clipped to, so the fallback shows the regions alone. It needs a design pass before it is used.

11. **"Your photograph is deleted after thirty days."** v2 says this in three places. The backend keeps a photograph for an hour and a result for thirty days (staging: three), so the promise holds. The words are v2's.

## Deferred to their milestones

- **F2:** the booking form submits to a stand-in, and the city list is v2's until F2 reads `/api/cities`. "Add to calendar" does nothing yet.
- **F3:** the try-on runs on its own, as the prototype does. Download and WhatsApp on the result do nothing yet. The error screen is reachable only with `?state=error` outside production, since v2's demo link to it is removed. F3 adds the heading and body for `render_failed` and `busy`.
