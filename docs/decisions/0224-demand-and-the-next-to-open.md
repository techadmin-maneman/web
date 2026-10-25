# 0224. Demand, and the next pincodes to open

- Status: accepted
- Date: 2026-10-26
- Topic: The ops console
- Amends [0221](0221-launches-scheduled-paused-and-checked.md)

## Context

The pincode plan's fourth part, approved by the owner on 25 October 2026. Where to open next was a guess from the
waitlist alone: nobody counted the visitors who looked up a pincode we do not serve and left. A launch was never looked
at again once live.

## Decision

1. **Demand is counted:** each lookup on the site of a pincode we do not serve, or one paused, adds one to that
   pincode's count for the day (`pincode_demand`, migration 0200). It holds no person, no address and no IP. Counts
   older than a year are let go by the housekeeping job.
2. **Next to open,** under Areas › Waiting: the pincodes not served, most waiting first, then most looked up in the last
   ninety days, each with its city and area where we hold it, else India Post's district and state.
3. **The last thirty days,** under Areas › Served: each pincode launched in that time, with how many of those waiting
   were told and how many visits have been booked there since, cancelled ones left out.
4. **Served pincodes out of every reach** raise one alert a city each morning, which closes itself once each is reached
   again or no longer served, since clients there are offered no start (ADR 0223).

## Consequences

- The plan's last step, a city's served kept from its pincodes, is not taken: `cities.served` also means "we go there"
  to the board, lead handling and the CRM before any pincode is live, so deriving it would change them. Cities keeps
  it as ops set it, and a launch still marks it.
- The counts can be inflated by someone looking up the same pincode over and over; they rank, they decide nothing.
