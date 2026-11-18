# The fidelity method

How `npm run fidelity` pairs the design with the build. Its screenshots are in `docs/fidelity/`, but for the site's: they are 11 MB and change with every PR of its redesign, so they stay out of git; run it locally, or take the nightly run's artifact. Every pair is shot afresh each night on main (`.github/workflows/nightly-browser.yml`, "fidelity"), as the run's `fidelity-pairs` artifact; a script that a change broke fails the run, and the run's issue says so.

## The site

`scripts/fidelity/fidelity.ts` opens each board of the site redesign (`design/site-redesign/boards`, approved 17 November 2026; ADR 0262) and the local build in Chromium, at the board's own width, 390 or 1440 px, and writes the pairs to `docs/fidelity/site/<width>/`: the home page's header, its eleven sections and its footer, and every other page whole.

- **The boards' runtime** is the design canvas's, `design/support.js`, with React 18.3.1, ReactDOM 18.3.1 and `@babel/standalone` 7.29.0 from unpkg, answered from `node_modules`.
- **Pictures.** A board names its pictures by the canvas's `/_blob/<id>`; the run answers each from the repository's own file, as `design/site-redesign/README.md` maps them.
- **Fonts.** The boards load IBM Plex Sans from Google; the build self-hosts it (`packages/brand/fonts-plex.css`). Both wait for `document.fonts.ready`.
- **Video** is blocked on both sides, so both show the poster.
- **A board's length.** A board is drawn at a phone's or a laptop's height with its page scrolling inside; the run unrolls it to its full length before it is shot.
- **Fixed bars** are hidden while the build's pages are shot.

Any difference in type, spacing, colour or order is a defect, but for the departures `docs/site-redesign/PLAN.md` lists and the boards' stand-ins: their one results pair, grey looks, guide photographs and "Prototype:" lines. Where a board draws a state the build reaches only by acting (a step of `/book` or `/try`), the pair is of the page as it opens; each state is paired as its PR builds it. The pairs v2's design made (`design/Mane Man Site v2.dc.html`) are gone with it.

## The kit

`npm run fidelity:ops` shoots the console's kit (`/_kit`, local builds alone) whole, in the light theme and the dark, to `docs/fidelity/ops/kit.png` and `kit-dark.png`: every part of `packages/ui` in its states, on paper and on the ink, and the console's frame. It has no board to pair with; it is how a part that changes is seen to change, and where a screen takes its parts from (`docs/patterns.md`).

## The client and technician apps

No harness pairs them now (ADR 0275). Their pairs were cropped from Phase 2's boards in `design/phase2`, frame by frame at 390 px; each app was since rebuilt to its redesign's prototype (`design/client-redesign/`, `design/tech-redesign/`), which draws no boards to crop a frame from, so the pairs compared the apps with a design they no longer follow, and the client app's run stopped at Home. Each change to either app is checked against its prototype screen by screen as it is reviewed (`.claude/rules/review-before-push.md`), at 360 and 390 px and, for the technician app, with its text at 130%. The Phase 2 pairs, their method and their departures from the boards are in this file's history before ADR 0275.

## The referral landing

`npm run build:site -- --env local && npm run fidelity:refer` writes `docs/fidelity/referral/<width>/`. The landing
has no board of its own in the site redesign: it is `/book`'s island with an invite (ADR 0265), so each of its states
is paired with `/book`'s board walked to the step that draws the same thing, at 390 and 1440 px: `arrival` (the
board's pincode step), `served` (the visit), `not-served` (the list), `on-the-list` and `booked`. The walk is a
visitor's, on the board itself (`scripts/fidelity/site-boards.ts`, `bookBoardAt`); `npm run fidelity` uses the same walk
for `/book`'s own states (`page-book-<state>`), and `tryBoardAt` for the try-on's (`page-try-<state>`: the look, where it
is sent, sent, and the photo error; the look shown once ready has no `?state=` and no pair).

- **The page's API is answered with the design's own example:** Rohit's invite, Sector 65 for 122018 and Bandra for 400050. No mm-api runs, Turnstile is never reached, and the cookie bar is answered.
- **The page's clock is Friday 20 September 2030 in India,** so a booking is confirmed for the Saturday after it on
  every run.
- **Every `/r/:code` is the one built page** (ADR 0027). The static server maps them as `run_worker_first` does
  behind Cloudflare, and `?state=` opens each state, as it does for the booking form.

What the landing has and `/book` does not stands as a difference: who sent it, the card, the invite's offer, and its
form asking for everything at once rather than a step at a time. The departures `docs/site-redesign/PLAN.md` lists
for `/book` hold for the landing too.

## The ops console

The console pairs with no board. Its Ops Console board drew the first frame and panels; the console now follows its own frame, navigation and page patterns, in a light and a dark theme (ADR 0208), so a pair with the board would show only that change. What holds its look instead is the kit, shot in both themes (above), and the shared parts it is built from (`packages/ui/README.md`, `docs/patterns.md`).
