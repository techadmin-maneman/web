# 0036. Geocoding, for the check-in's geofence

- Status: accepted
- Date: 2026-09-23

## Context

The prompt: "Addresses are geocoded when a client address is created or edited, and the coordinates stored on `addresses`. Choose the geocoder in an ADR." The coordinates exist for one purpose: the check-in's 200 m geofence (`src/policy/check-in.ts`).

`addresses` has held `lat`, `lng` and `geocoded_at` since migration 0008, and nothing has filled them.

The FSM trial found something that changes the question (`docs/decisions/fsm-trial.md`, question 4): **FSM geocodes its service addresses itself**, and returns `Service_Latitude` and `Service_Longitude` on the record. An address a client saves in our app is confirmed with them and entered against their FSM contact either way, because FSM is the system of record for clients.

## Decision

**No geocoder provider of our own for now.** The coordinates come from FSM's own geocoding of the service address, read with the rest of the contact, and are written onto `addresses` by the mirror.

**The geofence degrades honestly.** An address with no coordinates cannot be measured against, so the check-in is accepted, its row names no address, and the response carries `distance_m: null`. It is never silently treated as a pass at zero metres.

**Every check-in records the distance it measured and the radius in force**, whether it passed or not, which is what the owner tunes the 200 m from (`docs/open-points.md`, item 46).

## Consequences

- One less provider, one less key, one less bill, and no second opinion on where a client lives.
- We inherit FSM's geocoding quality. If the parallel run's recorded distances show it is not good enough for Gurgaon high-rises, item 26 stays open and Ola Maps or Mappls goes behind `providers/geocode.ts`, which this decision does not foreclose.
- The technician surface cannot refuse a check-in for an address FSM never geocoded. That is the right way round: a technician standing at the door is not the person to punish for a missing coordinate.
