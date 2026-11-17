# 0269. The design check's API side

- Status: accepted
- Date: 2026-11-17
- Topic: Field work
- Builds on [0267](0267-the-technician-design-check.md) and [0268](0268-the-visits-design-check.md), whose check it ends
- Amends [0267](0267-the-technician-design-check.md): what a past visit used

## Context

The design check of 17 November 2026 ([0267](0267-the-technician-design-check.md)) left seven of the prototype's states
for last, because the API did not yet give the phone what they show.

## Decision

1. **The client's history says which visits were the technician's own**: each visit carries `yours`, and the phone
   names the technician of one of theirs "You", as the prototype does.
2. **What a past visit used reads in the unit the stock counts it in**: each thing carries its unit, so the history
   writes "5 tape strips · 10 ml solvent". [0267](0267-the-technician-design-check.md)'s departure, a count after each
   name, no longer holds but for a thing used before the stock had codes, which has no unit to give.

## Consequences

The check's report, kept as the owner's tracker, marks each of these findings with its PR.
