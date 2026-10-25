# 0221. Launches scheduled, paused and checked first

- Status: accepted
- Date: 2026-10-25
- Topic: The ops console
- Amends [0071](0071-what-ops-see-before-a-setting-changes.md) and [0220](0220-opening-a-city-from-india-posts-pincodes.md)

## Context

The pincode plan's second part, approved by the owner on 25 October 2026. A pincode could only be served today: the
console refused a launch date still to come, since `served` alone decides booking. Ops could not say "Pune goes live
on the 5th" and leave it, could not see what a city still lacked before serving it, could not see what stopping a
pincode would leave behind, and had no way to stop taking new clients somewhere for a while without stopping everyone.

## Decision

1. **A launch is a record.** `pincode_launches` (migration 0197) holds pincodes of one city, held and not served,
   and the day they go live: scheduled, then live or cancelled, never deleted. A pincode is in one scheduled launch at
   most. Serving today stays the table's own step.
2. **The cron serves a launch on its day,** in the 10 am slot so those waiting are told at a civil hour, through
   `setServiceArea` as the console's serve does: the same audit, the same paced alerts. A launch it cannot serve
   (no active technician in the city by then) stays scheduled, says why, and raises an alert once, until ops add a
   technician or cancel it. A pincode served by hand before the day counts as launched then.
3. **Readiness is shown, not enforced.** Before scheduling, the console lists what the city has: active technicians,
   those trained to fit, technicians without working hours or a home pin, a stockroom, a GST registration for the
   state, and pincodes not yet on the map. Each missing one links to where it is put right. Only the first stops a
   launch, as it already stopped a serve (ADR 0117); the rest are for ops to weigh.
4. **Stop says what it leaves behind:** the visits booked ahead at those pincodes, and their clients. Stopping does
   not cancel them.
5. **Pause is not Stop.** A served pincode paused until a day takes no new consultation, on the site or in the app,
   and its visitors may join the waitlist; clients we already come to book every other visit as before. The pause ends
   by itself on its day, or ops resume it sooner.

## Consequences

- Someone who joins the waitlist of a paused pincode is not told when the pause ends, since nothing launches then.
  Telling them is a follow-up if it matters.
- A restore to an earlier minute can put a launch the cron served back to scheduled; its pincodes stay served, and the
  next run marks it live without telling anyone twice.
