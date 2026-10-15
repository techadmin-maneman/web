# 0184. The one-visit range

- Status: accepted
- Date: 2026-10-12
- Topic: Field work

## Context

A consultation and fit in one visit (ADR 0105) books a first fit whose client is seldom known: their hair profile is taken at the visit. The scope: its technician carries a one-visit range, the exact specs most common in their city, and a visit that matches none of it closes as a consultation. Tomorrow's kit check (ADR 0181) skipped such a fit, having no profile to match.

## Decision

1. **A kit with a one visit tomorrow whose client has no profile carries the city's one-visit range:** one of each of the five hair systems the latest forecast expects most in the technician's city over its horizon. The forecast's due and pipeline layers already read the profiles and fits we hold, so the range follows them without a second read of the history.
2. **The range is added to what the kit needs,** beside any known fit's piece, and short of it is proposed as tonight's top-up with the rest (ADR 0181). A kit with two such visits carries the range once.
3. **A one visit whose client already has a profile** takes the piece that profile matches, as any fit does.
4. **No forecast yet, no range.** The size is five, kept in the kit check; it can become a console setting if ops ask.

## Consequences

- Nothing matching on the day still closes the visit as a consultation (ADR 0105).
- Tests: `test/worker/inventory/kit-check.test.ts`.
