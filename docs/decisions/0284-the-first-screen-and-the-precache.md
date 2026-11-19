# 0284. A phone app's budget counts its first screen, and its precache has a ceiling of its own

- Status: accepted
- Date: 2026-11-19
- Topic: Platform
- Amends [0281](0281-the-consoles-first-load-counts-today.md) and [0023](0023-launch-hardening.md) on what a phone app's 200 KB budget counts

## Context

A phone app with a service worker, the technician's and the client's, counted every script its worker keeps against
its 200 KB budget, since a first visit fetches them all. The technician app shipped as one script of 200.0 KB, at its
budget, and its first screen painted at 2.42 s against 2.5 s on staging (finding C-014): the sign-in downloaded the
camera, the steps and the guides before it drew. Splitting the app so its first screen loads less made it fail its
budget, because the parts compress less well apart and the worker still fetches every one: 207.1 KB in all, for a first
screen of 147.1 KB.

The owner chose, 19 November, to count the first screen against the budget and to hold everything the worker keeps to a
ceiling of its own.

## Decision

1. **A phone app's 200 KB budget counts what its first screen loads:** the page's scripts and every script they import as
   they load, as the console's 150 KB already does (0281). A part loaded later is not counted there.
2. **What a service worker keeps has a ceiling of its own, 260 KB gzipped:** every script, and the worker. A first visit
   fetches it after the first screen has drawn, and a phone keeps it for working without signal.
3. **The technician app loads every screen behind Today the first time one opens**, in two parts: a job's screens (its
   card, the visit's plan, every step, the camera and the close-out), and the rest (kit, the week, the guides, alerts,
   Me and leave). Its first screen loads 147.1 KB; its worker keeps 207.1 KB.

## Consequences

- The build says both figures for a phone app and stops on either over its budget.
- A screen opened for the first time with no signal and before the worker has kept it shows the app's loading state,
  then the page reloads to the new release if its parts have gone (`loadOrReload`), as a lazy screen does in the
  console.
- The client app's first screen counts 105.0 KB and its worker keeps 190.3 KB, both within the new figures, with no
  change to the app.
