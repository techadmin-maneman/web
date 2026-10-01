# 0104. The try-on's look on WhatsApp only

- Status: accepted, on the owner's ruling D3 of 1 October 2026 (ADR 0025, item 88). Its notices await counsel (`docs/open-points.md`, item 146), its words the owner's second round (item 163), and its production run WhatsApp's (item 164).
- Date: 2026-10-01
- Amends [0014](0014-try-on-api.md), [0018](0018-one-look-pro-only-lead-notices.md), [0022](0022-site-departures-from-v2.md) (items 18, 19, 21 to 24, 30, 32, 33 and 38), [0024](0024-the-browsers-own-look.md), [0070](0070-vendor-correctness.md) and [0084](0084-a-clients-try-on-is-kept.md); follows [0082](0082-try-ons-in-the-app.md) and [0103](0103-the-home-pages-first-copy-round.md)

## Context

The owner's list of 1 October 2026, item 10: "Try-on images are sent to WhatsApp for privacy, not shown on the site." Asked how (ADR 0103, D3), the owner chose "WhatsApp only": the visitor gives their number before the look is made, the look is sent to WhatsApp and never shown on the site, and the consent words are redone, with counsel.

Until now the site did the opposite. The gate opened after v2's 20-second countdown, while the look rendered; the number was optional (ADR 0024), and either way the look opened on the next screen, beside the photograph on a slider, with Download and a WhatsApp share. A visitor who came back was shown their look again. `GET /api/tryon/result/{job_id}` gave the look's link to the gate's session or to the browser that made it, and the notices said "The result opens on the next screen either way".

## Decision

### The number first

The try-on runs upload, consent, stage, looks, gate, sent. Nothing renders before the gate, so v2's countdown is gone, and the looks screen's button continues to the gate.

- **The gate needs the name and the number**, since the number is where the look goes. Its button sends the look.
- **The claim comes before the render.** `POST /api/tryon/claim` is accepted once the photograph is uploaded and before its render is asked for. It carries the stage the visitor chose, which is the lead's extent of hair loss, since no render has recorded one yet. The look's message waits for the render, as a claim made while rendering did before.
- **The render needs the claim.** `POST /api/tryon/generate` refuses a try-on no claim has, `409 claim_required`.
- **The claim opens no session.** Nothing on the site reads one any more, so the `mm_tryon` cookie is gone, and `tryon_sessions` is written no more; the sweeper deletes what is left. The same number claiming again, after an answer was lost, gets its lead again; another number is refused.
- **A visitor who leaves between the two** leaves a claimed try-on with no render: it expires after the hour, as an unfinished upload does, and its message is skipped ("no look was made").

### Never on the site

- **No route hands a browser the look, or a link to it.** `GET /api/tryon/result/{job_id}` is gone, with the fifteen-minute browser link. `GET /api/result/{token}` stays: it serves the signed one-hour link a WhatsApp message carries, which the bridge fetches to send the image, under the same daily read ceiling (ADR 0014).
- **`GET /api/tryon/look` says only whether this browser has had its look**: the job's state, stage and look, never the image. It now answers for an expired look too, since the upload link refuses that browser another photograph whether or not its look is still kept (it answered 404 once the look expired, ADR 0024).
- **The site has no result screen**: no slider, no Download, no share. The browser never holds a look, so the slider's result frame and `site/src/lib/frame-aspect.ts` are gone; the home page's teaser keeps the design's own pair.

### The sent screen

After the claim and the render's request, the sent screen says the look is on its way to WhatsApp on the number given, that it is never shown on the site and is deleted after fourteen days, and what a simulation is; it offers Book a free consultation and Back to the site. Back leads to the site.

- **It watches the render**, every three seconds for five minutes at most, until it is ready. A render that fails shows the existing error screen, and its message is skipped, as before.
- **A visitor who has had their look** is told so on arrival, or when the upload link refuses them: "Your look has already been sent.", without the number, which the page does not know, and without the look. The error screen's "You have had your look." is gone.
- **Analytics.** `try_on_completed` is now the look asked for, since the page never sees the look.

### When WhatsApp cannot send the look

A try-on whose look could not be sent does not run (`src/policy/tryon-delivery.ts`).

- **`GET /api/tryon/availability`** says whether WhatsApp is on (`MESSAGING_ENABLED`). The site asks on arrival, with the look, and while it is off shows "The try-on is not available right now." with Book a visit instead and no Choose another.
- **The upload link refuses** `503 whatsapp_unavailable` before anything is stored or counted. **The claim refuses** it while messaging is off, and on staging for one of our own scripts' test records off the allowlist, whose message would be held back (ADR 0097). **The render refuses** it while messaging is off.
- **A number that has had its looks for the day** (`RESULT_MESSAGE_MOBILE_DAILY_LIMIT`, which the messaging queue takes as it sends) is refused at the claim, `429 rate_limited`, which the gate says on its own line. It is the number's limit, not the service's, so the visitor is told so rather than that the try-on is unavailable.
- **Production** keeps `MESSAGING_ENABLED` `"false"` until its own WhatsApp number goes live (`docs/go-live.md`; open points 38 and 164). Until then production's try-on does not run.

### The notices

- **`photo-v3` and `gate-v3`** are v2's words with the promise of a result on screen taken out: the simulation is sent to your WhatsApp and never shown on this site, and the gate makes it once it has the number. They still keep a client's try-on, so `KEEPING_NOTICES` holds `photo-v3` too (ADR 0084). They are placeholders until counsel words them (item 146).
- **Every build shows them.** Production can no longer show the approved `photo-v1` and `gate-v1` truthfully, so the build-by-build promise (`tryOnPromises`, `TRY_ON_PROMISE`) is gone, and **production's site build refuses until counsel approves them**. Production's `mm-site` serves its placeholder until the site's release (`docs/go-live.md`), so no release is stopped by this; `test/node/site-production-gate.test.ts` holds the build refusing these two and nothing else, and checks what a production build ships again the day it builds.
- **The API records only the current versions**: the upload link refuses any photo notice but `photo-v3`, and the claim any gate notice but `gate-v3` (`400 invalid_request`). Staging's consents under earlier versions stand as recorded.
- **The privacy page** says the number is given before the simulation is made, that it is sent there on WhatsApp and never shown on this site, and that the site sets one cookie for the try-on, remembering for thirty days that this browser has had its look. **The terms' try-on paragraph** says the simulation is sent to WhatsApp and never shown on this site, and names the hair system. **The teaser** says the look is sent privately to your WhatsApp, and so does the try-on page's description.

### What stays

One look per visitor and the signed `mm_look` cookie (ADR 0018, ADR 0024); the render pipeline; the message, `tryon_result_v1` with its signed link; a client's kept try-on (ADR 0084); and the client app's Photos tab, where a client still sees their own try-on behind their login (ADR 0082). The ruling is about the site, and the app is out of its scope; counsel is asked to confirm the notices cover it (item 146).

## Where the site now departs from v2 (ADR 0022)

- No countdown and no result screen; the steps are "of four".
- The gate's frame reads "For your WhatsApp only" where v2's reads "Your result · ready", and its button "Send my look" where v2's reads "Show me the result"; its fields are required again, reversing item 32.
- The sent screen and the unavailable screen, which v2 does not draw, use the error screen's frame and type.
- `npm run fidelity` pairs v2's processing and result screens with nothing (`docs/fidelity-method.md`).

Every word above that v2 does not have is ours until the owner's second round (item 163).

## Consequences

- **Every look made is a lead with a number.** A visitor who would not give one no longer sees a look.
- **Production's site cannot be built** until counsel approves `photo-v3` and `gate-v3` (item 146), and its try-on does not run until WhatsApp does (item 164).
- **Staging's looks made before this change without a number**: their browsers are told the look was sent, though none was. Staging keeps a look three days.
- **No database change.** The contract loses one route and gains one, the claim gains `stage` and loses `whatsapp_copy`, and two error codes are added; `docs/openapi*.json`, `docs/api*.md` and the generated types are regenerated.
- **Tests.**
  - `test/node/policy-tryon-delivery.test.ts`: the rule.
  - `test/worker/tryon-api.test.ts`: the claim before the render, the render refused without it, no result route, the look said without the image, and every refusal while WhatsApp cannot send.
  - `test/worker/sweeper.test.ts`: the message of a look never made is skipped.
  - `test/worker/notices.test.ts`, `test/node/site-content.test.ts` and `test/node/site-production-gate.test.ts`: the notices, the words, and the production build refused on them alone.
  - `test/node/site-tryon-machine.test.ts`: the screens.
  - `e2e/try.e2e.ts`, `e2e/try-flow.e2e.ts`, `e2e/try-api.e2e.ts` and `e2e/accessibility.e2e.ts`: the screens, the order of the calls, the sent and unavailable screens, and the local API end to end. The tests that asserted the look on screen now assert the sent screen.
