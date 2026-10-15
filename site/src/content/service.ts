// What the service is, in the words every page shares: where we come, and how long each visit takes.
//
// Each length is the backend's VISIT_BLOCKS here; a deploy's build lays over it the length ops gave each kind's service
// in the console, which the API answers with the published words (scripts/lib/site-words.ts), so the site says what a
// visit is booked for. The area is the client app's too (packages/web-kit/service-area.ts), until its wording is
// settled.

import { SERVICE_AREA } from "@maneman/web-kit/service-area";
import { lengthWords } from "@maneman/web-kit/visit-length";
import { VISIT_BLOCKS } from "@rules/config/scheduling.ts";
import type { VisitType } from "@rules/config/visit-types.ts";

export const serviceArea = SERVICE_AREA;

const lengthOf = (type: VisitType): string => lengthWords(VISIT_BLOCKS[type].minutes);

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
