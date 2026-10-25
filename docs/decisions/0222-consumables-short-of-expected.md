# 0222. Consumables short of what a visit expects are said why, and checked

- Status: accepted
- Date: 2026-10-25
- Topic: Field work
- Amends [0087](0087-consumables-and-stock.md)

## Context

The consumables step opened at what each visit's service expects, from Settings, and a technician could step every
count down to none and go on: the job closed with nothing used, so it cost nothing, and nobody was told. On 25 October
2026, watching the technician's day recorded end to end, the owner asked why the app allowed a procedure without its
consumables' cost, and chose a reason with ops told, over blocking a count below expected or costing the visit at
expected whatever was recorded.

## Decision

1. **A job that records less than its service expects of any consumable says why.** So does one that records nothing
   at all on a fit, a service or a replacement, whatever is expected, since such a visit always uses something. A
   consultation that used nothing owes none; a consultation and fit in one visit is a fit by what it used, unless the
   client said no at its piece step.
2. **The reasons are four:** the client's own supplies, ran out, not needed, other. The phone offers them as soon as
   the counts fall short and holds Next until one is picked; the API refuses the step without one, fields
   `short_reason` (src/policy/consumable-shortfall.ts holds the rule for both).
3. **Ops are given a task,** "Consumables short", in Operations: whose job, why, and each consumable's count against
   what was expected. It closes once ops have checked it against the kit, which settles the row it is read from
   (`consumable_shortfalls`, migration 0198). A corrected step replaces the row, or takes it away once nothing is
   short.

## Consequences

- A phone with the step queued before this release is refused once, and asks the technician to correct it.
- What was used is still what the technician records; the margin reads it as before. The task is where a wrong count is
  caught.
