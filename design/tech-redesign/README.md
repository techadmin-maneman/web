# Technician app redesign — source files

Received from the owner on 10 November 2026 with the brief `docs/prompts/tech-redesign.md`. Read-only. Do not edit these files; raise disagreements in a PR or an ADR.

| File | What it is | Build status |
| --- | --- | --- |
| `Technician App.prototype.html` | The approved prototype at 390 px, clickable, as the owner sent it (`mane-man-technician-prototype.html`). The panel on its right is not part of the app: it sets states (offline, an upload failing, ops refusing a step, a job cancelled, camera blocked, storage full, 360 px, large text, Hindi). It embeds IBM Plex Sans and its Devanagari cut, so it renders with no network | **Build.** Source of truth for the look of `mm-tech`; the brief wins on rules |
| `strings-hi.json` | The Hindi catalog: English key to Hindi, templates with parameters, patterns for counts and times, weekday and month tokens. Draft copy, owed a native speaker's review | **Build.** The Hindi the app derives its catalog from (`docs/technician-redesign/PLAN.md`, decision 10) |

These files supersede `design/phase2/Technician App.dc.html` for the technician app.

The plan, the mapping of every current state, and the backend gaps are in `docs/technician-redesign/PLAN.md`.
