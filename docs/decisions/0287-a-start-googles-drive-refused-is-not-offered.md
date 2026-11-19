# 0287. A start Google's drive leaves no room for is not offered again

- Status: accepted, on the owner's go-ahead of 19 November 2026
- Date: 2026-11-19
- Topic: Booking and visits
- Amends [0210](0210-booking-by-start-time.md) decision 6 on what the starts offered rest on

## Context

Every start is offered on the free drive estimate, and Google's Route Matrix checks the drives either side of the
one a client chooses before it is held (0210, decision 6). Where Google's drive is longer than the estimate, the start
is refused at the hold. The QA run's simulation found it refused on 19 of 35 days for the first start /book offered
(finding B-006), and the list the form and the app drew again after the refusal offered the same start, to be refused
again. Google's answer is kept a day (0120), but the offers never read it.

Tuning the estimate from the refusals #934 logs needs Cloudflare's Workers Logs; the owner chose, 19 November, to fix
the offer instead.

## Decision

1. **The starts offered read Google's kept drives.** A start next to a stop, or the day's first from home, is left out
   where Google's drive through those pins is kept and leaves no room for it, with the time to park, as the hold would
   find. Nothing is asked of Google for an offer: where no drive is kept, the estimate stands, as before.
2. **One look per gap.** The starts in one gap share their pins, so each set is looked up once for the request.

## Consequences

- Once a hold is refused for its drive, the start, and every other start in that gap Google's drive leaves no room for,
  is not offered again while Google's answer is kept, a day; the client is not sent round the same refusal.
- A start in a gap Google has not been asked about may still be refused at the hold, once.
- Offers spend nothing from the day's route ceiling.
- With the routes provider switched off, holds check no drive, but a drive Google gave before still leaves its starts
  out of the offers until it lapses, a day at most: what Google found of the roads still holds.
- Tests: `test/worker/booking/drive-check.test.ts` ("The starts offered beside a visit") and
  `test/worker/booking/kept-drives-offers.test.ts`.
