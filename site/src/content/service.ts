// What the service is, in the words every page shares: where we come, and how long each visit takes.
//
// The lengths are the backend's VISIT_BLOCKS, so the site says what a visit is booked for. The area is the client app's
// too (packages/web-kit/service-area.ts), until its wording is settled (open point 14).

import { SERVICE_AREA } from "@maneman/web-kit/service-area";
import { VISIT_BLOCKS } from "@rules/config/scheduling.ts";
import type { VisitType } from "@rules/config/visit-types.ts";

export const serviceArea = SERVICE_AREA;

/** Minutes, in words. A new length in VISIT_BLOCKS needs its words here, or the build stops. */
const MINUTES_IN_WORDS: Readonly<Record<number, string>> = {
  60: "an hour",
  90: "ninety minutes",
  135: "two and a quarter hours",
  180: "three hours",
};

function lengthOf(type: VisitType): string {
  const { minutes } = VISIT_BLOCKS[type];
  const words = MINUTES_IN_WORDS[minutes];
  if (words === undefined) throw new Error(`site/src/content/service.ts has no words for ${String(minutes)} minutes`);
  return words;
}

/** How long each visit takes, in lower case: "an hour". */
export const visitLength = {
  consultation: lengthOf("consultation"),
  service: lengthOf("service"),
  firstFit: lengthOf("first_fit"),
};

/** The same words opening a sentence: "An hour". */
export function capitalised(words: string): string {
  return words.charAt(0).toUpperCase() + words.slice(1);
}
