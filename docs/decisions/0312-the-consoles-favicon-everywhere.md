# 0312. The console's favicon, everywhere

- Status: accepted, on the owner's ruling of 24 November 2026
- Date: 2026-11-24
- Topic: Platform
- Amends [0286](0286-the-icons-are-the-mark.md) on the tab's icon

## Context

ADR 0286 drew every icon as the gilt mark on ink, with one exception: the console's tab linked the gilt mark's SVG on
nothing. So the site, the client app and the technician app showed a gilt mark on an ink square in a tab, and the
console a gilt mark alone. On staging, the owner saw the site's and the console's favicons differ, and asked on 24
November that the console's be used everywhere.

## Decision

1. **Every surface's tab icon is the console's:** the gilt mark's SVG, linked from the site, the client app and the
   technician app as the console links it.
2. **The PNG favicons beside it draw the same mark on nothing**, for a browser that reads no SVG icon: the site's 16,
   32 and 48 px and its favicon.ico, and each app's 16 and 32 px. They keep their sizes and the mark its width in them.
3. **The touch and home-screen icons stay the gilt mark on ink**, as 0286 drew them: a home screen draws them as tiles.

## Consequences

- On a dark browser tab, the gilt mark stands on the tab's own colour, as the console's always has.
- Tests: `test/node/apps/app/app-pwa.test.ts`.
