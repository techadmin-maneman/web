// How far along a client is, as its pill's tone: a lead to win, consulted on the way, fitted and active done.

import type { BadgeTone } from "@maneman/ui/Badge";
import type { ClientRecord } from "../api.ts";

type Stage = ClientRecord["stage"];

export const STAGES = ["lead", "consulted", "fitted", "active"] as const satisfies readonly Stage[];

export const STAGE_TONES: Readonly<Record<Stage, BadgeTone>> = {
  lead: "attention",
  consulted: "neutral",
  fitted: "done",
  active: "done",
};

/** Whether they have been fitted: a first fit, or any visit after one, is done. */
export const isFittedStage = (stage: Stage): boolean => stage === "fitted" || stage === "active";
