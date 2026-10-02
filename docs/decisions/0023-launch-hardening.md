# 0023. Launch hardening: headers, analytics, budgets

- Status: accepted. Item 2 was settled by the owner on 22 September 2026: Bot Fight Mode is off, option a (ADR 0025, item 12), and corrected 2 October 2026: JavaScript detections were still on. Section 3 updated 25 September 2026 for the booking pages of ADR 0051 and the referral landing.
- Date: 2026-09-22

## Context

F4 of the front-end prompt asks for security headers, analytics and conversion tags, SEO, and performance and accessibility budgets enforced in CI. This records how each is done, and one conflict between the prompt's content security policy and the Cloudflare zone.

## Decisions

### 1. Security headers

The build writes them into the Workers static-assets `_headers` file (`site/src/lib/static-files.ts`).

- **Content security policy.** It allows the site itself, Turnstile, Cloudflare Web Analytics, and the hosts of whichever analytics tags have an ID. Astro's inline scripts and styles are allowed by their SHA-256 hashes, which the build reads from the finished pages, so the policy needs no `'unsafe-inline'`.
  - Vite no longer inlines small assets as `data:` URLs: the policy allows none.
  - The R2 endpoint the prompt names is not needed, because the photo goes to the API (ADR 0022, 1).
  - `blob:` images are allowed, for the try-on's photograph and result shown from memory.
  - Cloudflare limits a `_headers` line to 2,000 characters. The policy is about 870 today, and a test fails if the policy with every tag enabled would go past the limit.
- **HSTS** for a year, without `includeSubDomains` or `preload`. The owner can add both once every subdomain of maneman.in serves HTTPS. **Changed 25 September 2026:** two years with `includeSubDomains`, as the apps already send it (`packages/web-kit/headers.ts`); every host under maneman.in the platform uses serves HTTPS on Cloudflare's certificate. `preload` stays off, and is the owner's call: once on the browsers' preload list the domain takes months to leave it (`docs/open-points.md`, item 87).
- **`Referrer-Policy: strict-origin-when-cross-origin`**, and `X-Content-Type-Options: nosniff`.
- **`Permissions-Policy`.** It turns the camera, microphone and location off everywhere, and allows the camera on `/try` alone, through `_headers`'s `!` detach. Cloudflare's asset server was checked under `wrangler dev`: `/try` gets `camera=(self)` only.
- **Caching.** Built files under `/_astro/` carry a content hash in their names, so they are cached for a year as immutable.

The local static server applies `_headers` as Cloudflare does. So every browser test runs under the real policy, and a test fixture fails any test in which the browser reports a policy violation.

### 2. Conflict: Bot Fight Mode's inline script (for the owner)

Cloudflare injects an inline "JavaScript detections" script into every HTML page on the zone. It is part of Bot Fight Mode, and it carries a value that changes with every request. A hash cannot allow it. Cloudflare adds a nonce to it only when the policy header carries one, and a static site cannot mint a new nonce for each request. Cloudflare's documentation says JavaScript detections cannot be turned off while Bot Fight Mode is on.

As built, the policy blocks the script. Each page then logs one policy error in the browser console, and Bot Fight Mode loses that signal. The site works either way. The owner chooses one of three options:

- **a. Turn Bot Fight Mode off for maneman.in (recommended).** Turnstile already guards every booking and every try-on upload, and the API has its own rate limits and daily ceilings.
- **b. Keep Bot Fight Mode, and accept the blocked script and its console error.**
- **c. Stamp a nonce per request.** A Worker in front of the site's HTML would add a fresh nonce to the policy and to the page's scripts, and Cloudflare would stamp the same nonce onto its own script. That costs one Worker request per page view, counted against the free plan's 100,000 a day (ADR 0009), which the API shares.

Staging runs as (b) until the owner decides.

**Decided: a.** Bot Fight Mode was turned off on 21 September 2026, since it challenged CI's smoke tests (ADR 0008's update of that day), and the owner ruled it stays off on 22 September 2026 (ADR 0025, item 12).

**Corrected 2 October 2026:** the script was still added to every page of every staging host, and blocked there, so JavaScript detections are on for the zone with Bot Fight Mode off. They are turned off in the dashboard (`docs/runbook.md`, step 14; `docs/open-points.md`, item 111), and never allowed with `'unsafe-inline'`. The same day showed Web Analytics' beacon reaching the app, ops and technician hosts, whose policies refuse it (item 144). Neither shows in a local run, the browser tests' or Lighthouse's, since both are added at the edge: so after every staging deploy, `npm run smoke:csp` opens each staging host's pages in Chromium and fails on any refusal.

### 3. Analytics

- **The tags.** GA4, the Google Ads conversion tag and the Meta Pixel load only when their ID is set for the environment, in `site/src/lib/analytics-ids.ts`. None is set yet; the owner supplies them. Staging's IDs must be test or debug streams, and GA4 marks every hit outside production as debug traffic. Cloudflare Web Analytics needs no code: Cloudflare adds its beacon at the edge, and the policy allows it.
- **The events.** The prompt's events fire from the booking pages and the try-on. Since ADR 0051 the booking pages are `/book` and the referral landing at `/r/:code`, one form with a pincode check; the Phase 1 form these events were first written for is gone. (Updated 25 September 2026: until then the new form fired none of them, so a paid campaign's booking was never counted.)
  - A booking sends `lead_submitted` with `page` (`book` or `invite`), `served`, the pincode's `area`, the `window` and `loss_extent` (null on an invite, which does not ask), then `booking_confirmed` with the `area`, the `window` and whether it was `booked` or `requested`.
  - A number left for an unserved pincode sends `lead_submitted` with `served` false and no window, then `waitlist_submitted` with the `area`.
  - The try-on sends `try_on_started` when a photograph is chosen, `try_on_gate_shown`, `try_on_claimed`, `try_on_completed` when the result is shown, and `try_on_failed` with its `failure_code`.
  - `try_on_additional_look` never fires, because each visitor gets one look (ADR 0022, 2).
- **Conversions.** `lead_submitted` and `try_on_claimed` are the conversions: the Google Ads conversion (one label for each) and Meta's `Lead`.
- **No personal data.**
  - The event types allow no name, number or image reference.
  - Every event also goes onto GA's `dataLayer`, loaded tags or not. The browser tests read it and fail on a name, a number, an invite code, a `blob:` URL or a result link.
  - On arrival, the address loses any query parameter that is not a campaign tag, so no tag reads a number someone put in a link.
  - **The referral landing's code.** `/r/RM4K7P` names one person's invite. Google's tags are told the address as `/r/`, the page sets `Referrer-Policy: strict-origin` so the next page's referrer carries no code, and the Meta Pixel is not loaded there at all: it reports the address as it stands and offers no way to change it. The landing's conversions reach Google's tags only. The landing's visitors arrive from a friend's WhatsApp message, not from an advert.
  - **The Meta Pixel's automatic collection is off** (`autoConfig`), so it reads no buttons or meta tags; on the landing those carry the referrer's first name.

### 4. Budgets in CI

The prompt names Lighthouse CI. Its latest release, `@lhci/cli` 0.15.1, pins an older Lighthouse and `inquirer`, which bring seven high-severity advisories that the CI audit refuses. So `scripts/lighthouse.ts` drives `lighthouse` 13.5 directly (`npm run lighthouse`).

- **The run.** It builds nothing itself. It starts the local API and serves the local build, then audits `/`, `/try` and `/book` on Lighthouse's mobile profile.
- **The budgets.**
  - Performance at least 90.
  - Accessibility, best practices and SEO at least 95.
  - LCP under 2.5 s and CLS under 0.1.
  - Total Blocking Time under 200 ms, standing in for INP. INP needs real interactions, which a page load cannot measure.
- **Two settings.** The "page is crawlable" audit is skipped, because every non-production build is `noindex`; production's pages are crawlable. The local server compresses text, as Cloudflare does.
- **Results.** Every page scores 99–100 for performance and 100 for the other three, with LCP at most 1.9 s.

Two changes got there:

- **₹ in EB Garamond comes from a one-glyph, 768-byte file** (`npm run fonts`). ₹ is the site's only character outside latin, and it used to cost the 57 KB latin-ext file. Instrument Sans has no ₹ in any subset, the design's Google copy included, so its ₹ comes from the system font, as before; its latin-ext file is no longer downloaded for it.
- **The hero footage starts once the page has loaded.** Before, it began downloading its 2.3 MB at once and slowed the poster, which is the LCP image.

axe checks every page and every try-on and booking state at both widths against WCAG 2.2 AA (`e2e/accessibility.e2e.ts`). A Playwright test holds the home page's JavaScript under 60 KB gzipped and checks that it loads nothing of the try-on.

### 5. SEO

- **Every page** has a title, a description, a canonical link to production's host, and Open Graph and X card tags. The canonical points to production from every environment.
- **The shared-link card** (`/og.png`) and the Apple touch icon are drawn from the brand kit at build time: the gilt lockup on ink, and the favicon drawing on ink. Since 25 September 2026 so are the tab's icons, as the kit's README asks: PNGs at 16, 32 and 48 px on ink, the 16 in the kit's silhouette cut. The page used to link the 32 px SVG itself, gilt on a transparent ground (2.4:1 on a light tab) and mostly the file's own provenance metadata.
- **The home page** carries `LocalBusiness` and `FAQPage` structured data, from content. The business entry holds only published facts: the WhatsApp number, the cities the FAQ names, and the price range from the price table.
- **The 404 page** is `noindex` with no canonical link.
- **The sitemap** lists the built pages, and production's `robots.txt` points to it.

## Consequences

- Adding an analytics ID adds its hosts to the policy on the next build. A new inline script is hashed automatically.
- A policy violation fails the browser tests, so a new third-party script or a `data:` URL is caught before it ships.
- The Bot Fight Mode decision is needed before production goes live.
