# The prompts this repository is built from

The owner's instructions to the coding agent, committed word for word as they were given. They are the brief; the decisions made while building them are in `docs/decisions/`.

| File | Prompt | Status |
|---|---|---|
| `phase1-backend.md` | Phase 1 backend, rev 4.1 | Built: M1–M4 |
| `phase1-frontend.md` | Phase 1 front end, rev 2 | Built: F1–F4, on staging |
| `phase2-backend.md` | Phase 2 backend, rev 2, 21 Sep 2026 | Built: P2-M0 to P2-M6, on staging; the proofs still owed are `docs/open-points.md`, item 91 |
| `phase2-frontend.md` | Phase 2 front end, rev 2, 21 Sep 2026 | Built: P2-F1 to P2-F5, on staging; the technician field test is still owed (`docs/open-points.md`, item 72) |

Do not edit these files, and do not let a formatter touch them (`.prettierignore`). A change to the brief comes as a new revision from the owner. Where the build departs from a prompt, the reason is an ADR; the Phase 2 departures are listed in `docs/decisions/0025-phase-2-conflicts-register.md`.
