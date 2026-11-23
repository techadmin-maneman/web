# 0298. Schedule goes back to past weeks, and never past this one

- Status: accepted
- Date: 2026-11-23
- Topic: Field work
- Amends [0249](0249-schedule-kit-and-me.md), decision 1: Schedule is no longer only today and the six days after it

## Context

Schedule showed today and the six days after it, with no way to another week. The owner asked on 22 November 2026 for
the week view to go back to past weeks only, forward staying at this week. The day's list (`GET /api/tech/jobs`)
refuses a date before yesterday on purpose: paging back through it would read every past client's card. On 23 November
the owner ruled a new read that gives only the technician's own past jobs, with nothing of the clients.

## Decision

1. **`GET /api/tech/past-week?from=`** (`src/domain/field/past-jobs.ts`) gives the seven days from `from`, each with the
   technician's own jobs then, drafts left out: each job's time, length, kind and how it closed (its status and the
   outcome that landed). It carries no name, number, address or area, and opens no card. A week that does not end
   before today is refused (`pastWeekFrom`, `src/policy/job-visibility.ts`); any earlier week may be read.
2. **Schedule steps a week at a time** (`apps/tech/src/schedule/past-week.ts`): a step back shows the seven days
   before the week shown, counting back from today by sevens, and a step on comes back towards this week, which it
   cannot pass. Both steps sit either side of the week's range, under the title, each a technician's tap. A past job is
   drawn by its kind, how it closed ("Done", "No-show", "Not closed") and its length, and links to nothing.

## Consequences

- A technician can look back over their past work, as their per-visit incentive counts it, without the app holding
  any client's details for past days.
- A past week is read from the API each time; with no signal it says it did not load, as this week's days the phone
  does not keep do.
- The prototype has no week steps: the two chevrons are this change's own, from the shared `IconButton`.
