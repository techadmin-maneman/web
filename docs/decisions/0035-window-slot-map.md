# 0035. The window-to-slot map

- Status: accepted, with placeholder times (`docs/open-points.md`, item 53)
- Date: 2026-09-22
- Topic: Booking and visits

## Context

The client app offers three windows: morning 9–12, afternoon 12–4, evening 4–8. The dispatch board has four slots a day, and sizes blocks in slots: consultation and service one, replacement one and a half, first fit two. The prompt: "Define the mapping in config `WINDOW_SLOT_MAP` and record it in an ADR. The two designs do not agree, so the mapping must be explicit, not guessed." Neither design gives the slots' times.

## Decision

`src/config/scheduling.ts` holds the day:

| Half-slot | 0       | 1       | 2         | 3         | 4         | 5         | 6       | 7       |
| --------- | ------- | ------- | --------- | --------- | --------- | --------- | ------- | ------- |
| Starts    | 09:00   | 10:30   | 12:00     | 13:00     | 14:00     | 15:00     | 16:00   | 18:00   |
| Window    | morning | morning | afternoon | afternoon | afternoon | afternoon | evening | evening |

- **`WINDOW_SLOT_MAP`** is the half-slots a visit booked in each window may start in: morning 0–1, afternoon 2–5, evening 6–7. A visit may run on past its window's end, but not past the day's last half-slot, so a first fit cannot start in the evening.
- **FSM books a visit** from its half-slot's start for its length: consultation 60 minutes, service 90, replacement 135, first fit 180. The owner kept all four on 24 September 2026, so these are decisions and not the design's guesses (`docs/open-points.md`, "Visit lengths").
- **Slots are counted in halves** so a replacement's block is whole.

## Consequences

- The client's window and FSM's times agree: a visit starting at 12:00 is an afternoon visit to both, and the mirror reads it back as one.
- The owner rules the real times and map. Each is one constant. The lengths are ruled.
