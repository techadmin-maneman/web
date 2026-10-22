# 0213. The site's second copy round

- Status: accepted
- Date: 2026-10-19
- Topic: The site
- Amends [0103](0103-the-home-pages-first-copy-round.md) and [0204](0204-the-sites-price-pipeline-removed.md)

## Context

On 19 October 2026 the owner sent nineteen points on the site and its copy, with the photos and films of a real fit in a Drive folder ("Procedure photos and videos - 15 Oct 2026"), and answered four questions the same day: the site's WhatsApp number is +91 90345 72990; the four packages are Essential, Active, Natural and Celebrity, Celebrity in place of NatMax; the 10,000+ counts our specialists' past fits; the pictures come from the folder.

## Decision

1. **Real material, published.** The hero film is a montage of the fit (`fit-film.mp4`, its phone cut and poster); How it works shows a head measured, a client after the fit, and a hair system taped for bonding; the try-on teaser shows a photo and the try-on's own side part look on it. None of it carries the Placeholder tag (`isTaggedPlaceholder`).
2. **The results** sit beneath the hero: four before-and-after pairs in a strip that scrolls sideways, under "10,000+ transformations by our specialists. Quietly." Three pairs are one client's real fit. The fourth went through an AI image tool, so its card says "Illustration". Each card's line is a caption, not a quote, and names nobody. "What it is" loses its plate.
3. **Gone from the home page:** the technicians, the clients' quotes, and Norwood stages I and II and every stage's description. The scale ends on a hairline restored, "From these to this in" the first fit's length. Materials and construction moves to a guide, `/guides/hair-system-materials`, without its ratings.
4. **Other treatments' costs.** The comparison gives a transplant's typical cost (Rs. 1.2–3 lakh, very often repeated) and medication's (Rs. 20,000–50,000 a year, for life), and medication's result in 6–9 months with long-term side effects. The publish gate still refuses a price of ours typed anywhere (`THEIRS`, `site/src/lib/publish-gate.ts`).
5. **The booking page** opens on "Meet your hair again. Completely private, right at home.", its first step is "About you", and its button "Book your free at-home consultation →". Its WhatsApp line is new words, "Send my booking confirmation and updates via WhatsApp.", recorded as `site-consultation-v2` and `referral-consultation-v2`, and **starts ticked** on both consultation forms. The waitlist's and the launch alert's boxes do not.
6. **Lengths under two hours are said in minutes**, "60 minutes", "90 minutes" (`lengthWords`). The owner's lengths, a first fit of 90 minutes and a service visit of 60, are the console's: set on staging on 19 October 2026; production's are set in its console.
7. **The hero's line turns round and round**, each phrase 3.2 seconds, with "Confidence restored." before "Be the Main Man again."; Pause stops it with the film (WCAG 2.2.2). Every phrase keeps to one line: on a phone narrower than about 400 px the type shrinks to fit the longest. (Changed 22 October 2026 from "Get your confident self back.", which took two lines and left a gap under the others.)
8. **"Use the camera"** opens the front camera in the page and takes the photo there. Where the page cannot open one, the phone's own camera is asked for through the file input, as before; a device with no camera is not offered it.
9. **Words kept from earlier rulings:** nothing claims the hair is undetectable, since the FAQ says a hand run through it can tell ("seamless, natural-looking hair"), and the site writes "Rs.", never the rupee sign (ADR 0025).

## Consequences

- Production's build waits on counsel for the new WhatsApp line and its starting ticked (open point 187), as it already does for the try-on's notices (item 146).
- Tests: `test/node/site/site-content.test.ts`, `e2e/home.e2e.ts`, `e2e/book*.e2e.ts`, `e2e/refer-landing.e2e.ts`, `e2e/try.e2e.ts`.
