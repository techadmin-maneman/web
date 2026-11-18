# 0260. Ratings

- Status: accepted
- Date: 2026-11-16
- Topic: Messages and the CRM
- Builds on [0252](0252-client-app-redesign.md), whose past visit the stars are on, and [0249](0249-schedule-kit-and-me.md),
  whose quality on Me counts them

## Context

The owner's ruling 9 on the client redesign keeps ratings and shows them to the technician as their quality figure. No
table held a rating: the prototype draws five stars on a past visit, "How was this visit?", and the brief's W8 asks for
`visit_ratings (appointment_id, stars, at)`, one per closed visit, a Care task under four, and the technician's average
over the last 90 days on Me.

## Decision

1. **One rating a visit, once, within days of it.** `visit_ratings` (migration 0214) keeps the client's stars, one to
   five, with the technician who did the visit. `POST /api/visits/{id}/rating` takes them for a visit of the client's
   that ended with something done or partly done (`VISIT_ENDED`), within `ratings.rate_within_days` of it; a second is
   refused (`already_rated`), as is a visit not done (`visit_not_done`) and one past the days (`rating_closed`).
   `GET /api/visits/{id}` carries the rating and whether the visit may be rated now (`rateable`).
2. **The rules are ops' setting** (owner, 16 November 2026). One setting, `ratings` in Settings · Rules: under how many
   stars Care call (`low_below`, 4), the days the technician's average covers (`average_days`, 90), the fewest ratings
   it shows from (`shown_from`, 5), and the days after a visit it may be rated (`rate_within_days`, 30).
3. **A low rating is judged when given.** Each rating keeps `low`, under `low_below` as it stood then, so a later
   change of the setting moves no rating. A low one is a Tasks row, `low_rating`, for Customer Care, due in 48 hours
   (`task_sla_hours`), closed with what the client said; the queue reads the low ratings no closure has settled.
4. **The technician's figure.** `GET /api/tech/quality` adds the average of their ratings over `average_days`, to one
   place, and the days it covers; Me shows "Client rating, 90 days · 4.6 of 5". It shows none until `shown_from`
   clients have rated them, and never how many did (owner, 16 November 2026): a count beside the average would tell
   one new rating from the change.
5. **On the past visit.** The client app draws the stars with `packages/ui/StarRating`, five buttons (the arrow keys
   would choose radios as they move), then thanks the client in a status line; a low one points to reporting what went
   wrong. The stars the visit carries are shown however they were given.
6. **Erasure and the client's copy.** The stars stay on erasure, for the technician's figure, and hold no words; Care's
   closing note on a low rating is cleared with the client's other words. The client's data copy lists their ratings.

## Consequences

- The ops console's Tasks names the new group "Low rating", with the stars, the visit and its day, and the technician.
- The technician app's Hindi adds the figure's words; a native speaker's review is still owed for the app's Hindi.
