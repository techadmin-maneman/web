# 0295. The console's first load is held to 175 KB

- Status: accepted
- Date: 2026-11-23
- Topic: Platform
- Amends [0252](0252-client-app-redesign.md), decision 8: the console no longer keeps 150 KB

## Context

The console's first load, the JavaScript its first screen fetches, was held to the prompt's 150 KB gzipped
(`scripts/lib/spa-build.ts`, ADR 0043's budget for every app). It stood at 149.9 KB once Reports › Driving was added (ADR
0294), with the console's redesign still to come. The phone apps' budget was raised to 200 KB for their redesigns (ADR
0247, ADR 0252). The owner ruled on 22 November 2026 that the console's is raised to 175 KB, and that sections a first
screen does not need keep loading when they are opened.

## Decision

1. **175 KB** gzipped is the console's first load ceiling (`BUDGET_BYTES`, `scripts/lib/spa-build.ts`); a build over it
   fails, as before.
2. **Sections load when opened**, as they do now (`apps/ops/src/App.tsx`, `lazyScreen`), and each PR that adds to the
   console says the figure the build prints.

## Consequences

- The redesign's shared parts can join the first load without each one waiting on a section to be split off first.
- The ceiling is still a ceiling: the console's first screen stays light on a phone over mobile data.
