# 0278. A technician in training takes no visits

- Status: accepted, on the owner's ruling of 18 November 2026
- Date: 2026-11-18
- Topic: Booking and visits
- Amends [0119](0119-blackouts-by-city-and-trained-fitters.md)

## Context

Training was one flag, `fits_trained`, which kept first fits and replacements from a technician not trained to fit
(ADR 0119). A technician added today could be given consultations and service visits at once, with no training at all.

## Decision

1. **Training is a state.** `technicians.training_end_date` holds the day ops expect a technician's training to end;
   null once ops mark it done, or for one never in training. Ops set it when they add a technician, or later, and
   clear it on their record when the training is done. It does not end by itself on the day.
2. **In training, no visit of any kind.** Booking offers no slot of theirs, the dispatch board offers them no job, and
   a move onto them is refused (`in_training`). A visit already theirs stays theirs, as a moved visit keeps its own
   technician.
3. **The console shows the day** on their record's head, and on their details, where it is changed.
4. **A city's readiness counts trained technicians only** (ADR 0221): a city whose only technicians are in training
   is not ready to launch.
5. Trained to fit stays apart: a technician out of training takes first fits only once trained to fit as well.

## Consequences

- A technician added with no training date takes visits at once, as before: ops give the date to one who needs it.
