// What the service is, in the words every page shares: where we come, and how long each visit takes.
//
// The lengths are the backend's VISIT_BLOCKS, so the site says what a visit is booked for. The area is the client app's
// too (packages/web-kit/service-area.ts), until its wording is settled.

import { SERVICE_AREA } from "@maneman/web-kit/service-area";
import { VISIT_BLOCKS } from "@rules/config/scheduling.ts";
import type { VisitType } from "@rules/config/visit-types.ts";

export const serviceArea = SERVICE_AREA;

/** A visit's length in figures, as a sentence says it: "1 hour", "90 minutes", "2 hours 15 minutes". */
function lengthOf(type: VisitType): string {
  const { minutes } = VISIT_BLOCKS[type];
  if (minutes < 120 && minutes % 60 !== 0) return `${String(minutes)} minutes`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const whole = `${String(hours)} ${hours === 1 ? "hour" : "hours"}`;
  return rest === 0 ? whole : `${whole} ${String(rest)} minutes`;
}

/** How long each visit takes: "1 hour". */
export const visitLength = {
  consultation: lengthOf("consultation"),
  service: lengthOf("service"),
  firstFit: lengthOf("first_fit"),
};

/** The same words opening a sentence: "An hour". */
export function capitalised(words: string): string {
  return words.charAt(0).toUpperCase() + words.slice(1);
}
