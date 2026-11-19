# 0281. The console's first load counts Today, and Today holds its room

- Status: accepted
- Date: 2026-11-19
- Topic: Platform
- Amends [0023](0023-launch-hardening.md) on what the console's 150 KB budget counts

## Context

The console has no service worker, so its build counted only the scripts `index.html` loads. Every first visit opens
Today at once, and Today's section is loaded as the page opens, so a first visit fetched 165 KB of gzipped JavaScript
while the build said 130 KB. Today's tasks pulled the task drawer, the booking drawer and Care's section in with them,
through one helper imported from Care's index.

Today's figures were drawn only once read, and a line beneath one figure gave every tile its room when it came, so the
page moved twice as it loaded: a layout shift of 0.22 on a phone and 0.39 at a desk, over the 0.1 budget.

## Decision

1. **The budget counts what a first visit loads:** the page's scripts and the section it opens on, each with every
   script it imports as it loads (`scripts/lib/spa-build.ts`; the console names `TodayScreen`). A section loaded when
   it opens later is not counted.
2. **Today loads only what its rows show.** The way to where a task is decided is a file of its own; the task drawer,
   the booking drawer, a claim's photographs and who was at fault load when opened; a message kind's name is a shared
   helper (`apps/ops/src/lib/message-kind.ts`). The first load is 146 KB in staging and production builds.
3. **Today's figures hold their room while read:** a figure being read shows its label over a muted dash, said as
   loading, and keeps the room of the line beneath it where it has one once read. A figure the person may not read is
   not drawn.

## Consequences

- A section that grows Today's imports past 150 KB fails the build, as any first load does.
- Opening a task's drawer or a booking from Today fetches its part then, once, with nothing drawn meanwhile. A part
  that will not load reloads the page as any section loaded on opening does (`loadOrReload`), at the moment it opens,
  before anything is typed in it.
