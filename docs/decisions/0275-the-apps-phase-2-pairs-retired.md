# 0275. The apps' Phase 2 fidelity pairs retired

- Status: accepted
- Date: 2026-11-18
- Topic: Platform
- Amends [0043](0043-client-app.md): `npm run fidelity:app` no longer pairs the client app's frames, and the technician
  app's `fidelity:tech` goes with it

## Context

ADR 0043 had `npm run fidelity:app` pair each frame of `design/phase2`'s client app board with the app in the same state,
and `fidelity:tech` did the same for the technician app; the nightly browser run shot both. Each app was since rebuilt to
its redesign's prototype (`design/client-redesign/`, `design/tech-redesign/`), which draws no boards to crop a frame
from, so the pairs compared the apps with a design they no longer follow. The nightly run failed every night in its
fidelity job, at the client app's Home, waiting for a heading the redesign removed (issue #816).

## Decision

1. **The two apps' Phase 2 pairs are retired**: their scripts, their nightly steps and their pictures under
   `docs/fidelity/`. The site's pairs, the referral landing's and the console's kit run on.
2. **Each change to either app is set beside its prototype as it is reviewed** (`.claude/rules/review-before-push.md`),
   at 360 and 390 px and, for the technician app, with its text at 130% (`docs/fidelity-method.md`).
3. **The old pairs' method and their recorded departures from the boards stay readable** in `docs/fidelity-method.md` as
   it stood at commit b610fa233, which ADRs 0056, 0059, 0079, 0080, 0086, 0087 and 0092 point to for their departures.

## Consequences

- Nothing automated checks either app against its prototype between changes; drift is caught only as each change is
  reviewed. A pairing harness for the prototypes is a separate piece of work, if wanted.
- The nightly run's fidelity job builds only the site and the console.
