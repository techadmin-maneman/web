// A visit's photographs: a before set and an after set, of the same five angles. The technician's phone takes them
// (src/domain/field/tech-photos.ts).

import { PHOTO_ANGLES, type PhotoAngle } from "../../policy/in-job-steps.ts";

export const PHASES = ["before", "after"] as const;
/** The prompt's five angles, in the order they are taken. */
export const ANGLES = PHOTO_ANGLES;
export type Phase = (typeof PHASES)[number];
export type Angle = PhotoAngle;
