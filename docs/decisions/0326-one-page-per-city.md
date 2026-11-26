# 0326. One page per city, and one footer

- Status: accepted
- Date: 2026-11-26
- Topic: The site
- Amends [0321](0321-the-gurgaon-page.md): Gurgaon's paid ads land on Gurgaon's city page, not on a page of their own
- Amends [0325](0325-search-pages-and-opening-hours.md): a city's page is the home page's sections, with no words or
  questions of its own

## Context

Gurgaon had two pages for one search: `/gurgaon`, the page paid ads land on (ADR 0321), built from the home page's
sections with the city's own films, and `/areas/gurgaon`, the page a search for a hair system in Gurgaon lands on (ADR
0325), a page of text with draft words and three questions of its own. Both were indexed, and each competed with the
other. The city pages were linked from `/areas` alone; the home page alone had the full footer, and every other page a
slim one with no number, no questions and no cities. The owner asked on 26 November 2026 for the best of these, and
ruled: every city ops serve has the full page; it has a section of the areas we cover there, then the home page's own
questions; Gurgaon's draft paragraphs and questions are dropped, its other words are final and nothing is tagged a
draft; the city pages stay at `/areas/<city>`, where the site's Worker already runs, so it can list a city's areas and
send away a city no longer served.

## Decision

1. **One page per city, at `/areas/<city>`**, for each city ops serve (ADR 0325): the home page's sections with no
   price, in the order `/gurgaon` had them. The hero names the city ("Gurgaon · home service"); a city with footage of
   its own clients, as Gurgaon has, shows it in the hero and their films beneath, and any other has the home page's
   hero and no films section. The guarantee and the founder's note, with his own fit; the three steps at home; the
   try-on; the areas we cover there, which the Worker lists from the served pincodes and shows; the home page's
   questions, which are the page's FAQ for search engines; and the close. The sticky bar is on it, as on the home page.
2. **`/gurgaon` sends its visitor on to `/areas/gurgaon`** for good (301), with the ad's tags, so a link already
   given out still lands; the ads themselves name `/areas/gurgaon`.
3. **One footer on every page but the flows**: the full one, with an Areas column of each city ops serve and all of
   them at `/areas`. `/book`, the referral landing and `/try` keep none (ADR 0265). The slim footer is gone.

## Consequences

- A city ops start serving gets its full page at the next deploy or words publish, as before; one with no clients'
  footage yet has the home page's.
- The paid ads' final address is `/areas/gurgaon`; the ad can still display `maneman.in/Gurgaon`.
- Tests: `e2e/gurgaon.e2e.ts`, `e2e/guides.e2e.ts`, `e2e/home.e2e.ts`, `e2e/launch.e2e.ts`,
  `test/worker/site/site-worker-cities.test.ts`.
