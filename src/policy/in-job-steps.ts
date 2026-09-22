// The steps of a job, one screen each (docs/prompts/phase2-backend.md, "Technician and dispatch rules, from the designs").
// The rules as the prompt states them; their code arrives in P2-M4.

export const RULES = [
  "Five before photographs: front, top, left, right, hair.",
  "Consumables used, with quantities.",
  "The piece: replacement jobs only. Scan the label code (for example MM-STD-4417-B) or pick from the client's pieces in FSM.",
  "Five after photographs.",
  "Outcome: Done, or Partial with a reason.",
  "Duration runs from Start job to the outcome. The technician never types a time.",
] as const;

/** The five angles of a before or after set, in the order they are taken. */
export const PHOTO_ANGLES = ["front", "top", "left", "right", "hair"] as const;
export type PhotoAngle = (typeof PHOTO_ANGLES)[number];
