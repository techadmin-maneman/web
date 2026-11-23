# 0305. A technician's start date

- Status: accepted
- Date: 2026-11-24
- Topic: The ops console

## Context

The console knew when a technician was added, but not when they started with us. The redesign of 22 November asks
for a start date on Add and Edit, and "Started ..." in a technician's head (its change C5, which the owner approved on
22 November with the rest of the redesign's section C).

## Decision

1. **A technician has a start date, the day they started with us** (`technicians.started_on`, migration 0236). It is
   given on Add and Edit, may be left out, and may be taken off; null says it is not known.
2. **The head says "Started 3 Mar 2026"** where it is given, and nothing where it is not.
3. **It decides nothing else**: what a technician is offered, their pay and their training are as before.

## Consequences

- Every technician added before migration 0236 has none until ops give it.
- It is the technician's own record, not a client's, so it is in no personal data export or erasure.
