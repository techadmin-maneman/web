# 0244. The visit engine, its plan, and the photographs

- Status: accepted
- Date: 2026-11-11
- Topic: Field work
- Follows [0243](0243-job-and-the-door.md)

## Context

The brief (`docs/prompts/tech-redesign.md`, "Visit engine") asks for a visit as an ordered list of screens per job
type, built as data, with a visit plan, and photographs taken five angles at a time with a head-shape guide, the
current angle marked, Retake, the torch, "Saved on phone", and Compare. The plan (`docs/technician-redesign/PLAN.md`,
section 4) maps the screens onto the API's events; PR 5 builds the engine, the plan and the photographs, and PR 6 the
other steps.

## Decision

1. **The engine is a table per visit type** (`apps/tech/src/visit/engine.ts`): the screens in the brief's order, each
   with the API's event it feeds. A screen shows only where the card's steps carry its event, so the API stays the
   judge of what a visit takes. The hair profile, which the API does not order, comes before the hair system, as the
   brief draws it; the phone's order of steps is the engine's.
2. **The screens this PR has are the steps the app has today**: before photos, the tasks (titled Service, Fitting, or
   Scalp and hairline), hair profile, hair system, consumables, after photos and outcome. Colour and style, Options and
   Decision join the table in PR 6.
3. **The visit plan is `/jobs/{id}/plan`**: each screen done, now or to do, "n of N done", the visit's time gone with
   "Finish by", and a step the API refused marked "Needs a fix". A screen done or under way opens from it; one to do
   does not, since the API would refuse it out of order. The job opens it once the visit has begun.
4. **The photographs are a camera screen of their own**, in the camera's chrome: the title with the angles taken, the
   torch, the view with its guide and the angle's prompt, the five angles in a strip with the one to take in brass,
   Retake, the shutter, and "Saved on phone". Phone storage full is a red bar with the shutter off; a camera that will
   not open says so and offers the set without photographs, which ops are told of, as before.
5. **Compare** lays a photograph over the top half of the view: before the visit, the client's last after photograph of
   that angle; after it, this visit's own before photograph. Both come from the API,
   `GET /api/tech/jobs/{id}/compare/{phase}/{angle}`, under the job's own rule, and are never kept (no-store); with no
   signal, or none to compare with, Compare does not show.

## Consequences

- The steps not yet redrawn keep their frame until PR 6, which gives every step the new head, the step bar and "All
  steps".
