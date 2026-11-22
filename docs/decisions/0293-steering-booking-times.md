# 0293. Clients are steered to the times that drive least

- Status: accepted
- Date: 2026-11-22
- Topic: Booking and visits
- Amends [0289](0289-who-takes-a-visit.md)

## Context

Booking offered a client every start some technician could take, and each cost the same to pick, though some add far
more driving to a technician's day than others (ADR 0289). The owner ruled on 22 November 2026 that clients are
steered: the cheapest times are marked, and a time that adds too much driving is not offered to them, never the day's
last; ops still see and may book every time. Both figures are ops settings. A cap on the driving a time adds in all
hid nearly every time on a quiet day, where a lone visit counts the drive there and home again, so the owner ruled the
cap is measured from the day's best time.

## Decision

1. **The policy** (`src/policy/steering.ts`): of a day's starts, each weighed by its best technician (who takes it,
   ADR 0289), a start that adds more driving than the day's least-driving start, by more than `drive_cap`, is not
   offered, unless it is the day's last start; of those offered, the `recommended` that cost least, the earlier first
   where they cost the same, are marked Recommended. A start whose best technician has no home pin, whose driving
   nobody can tell, neither sets the day's best nor is left out, and is marked after those whose home is known, as
   booking weighs who takes a start.
2. **Ops set both** in Settings › "Times offered to clients" (`steering`): three times a day marked, and 30 minutes
   more driving than the day's best, until they change them; no time marked at 0.
3. **Clients only.** The app's and the site's times are steered (`src/domain/booking/availability.ts`); a client's
   hold takes only a start they are offered (`src/domain/booking/hold-slot.ts`), so a crafted request cannot take a
   hidden one. The console's times are not: ops see every start with its driving, and may book any.
4. **The app marks them** (`apps/app/src/booking/steps/WhenStep.tsx`): "Recommended" beneath the time, in the shared
   time grid (`packages/ui/TimeChoice.tsx`). A time not offered is drawn as one taken. The site marks nothing.

## Consequences

- A quiet day, whose starts drive alike, offers them all; a day always offers its last, so none goes dark.
- Marking reads no more than offering did: the cost is the one booking already weighs each start by.
