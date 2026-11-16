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

1. **One rating a visit, once.** `visit_ratings` (migration 0214) keeps the client's stars, one to five, with the
   technician who did the visit. `POST /api/visits/{id}/rating` takes them for a visit of the client's that closed with
   something done or partly done; a second is refused (`already_rated`), as is a visit not done (`visit_not_done`).
   `GET /api/visits/{id}` carries the rating.
2. **Under four, Care call.** A rating under four is a Tasks row, `low_rating`, for Customer Care, due in 48 hours
   (`task_sla_hours`), closed with what the client said. The queue reads the low ratings no closure has settled.
3. **The technician's figure.** `GET /api/tech/quality` adds their ratings over the last 90 days and the average to one
   place; Me shows "4.6 of 5 · 23 ratings", or none yet.
4. **On the past visit.** The client app draws the stars with `packages/ui/StarRating`, then thanks the client; under
   four, the line points to reporting what went wrong.
5. **Erasure.** The stars stay, for the technician's figure; Care's closing note on a low rating is cleared with the
   client's other words.

## Consequences

- The ops console's Tasks names the new group "Low rating", with the stars, the visit and its day, and the technician.
- The technician app's Hindi adds the figure's words; a native speaker's review is still owed for the app's Hindi.
