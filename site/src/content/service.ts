// What the service is, in the words every page shares: where we come, and how long each visit takes.
//
// The lengths are the backend's VISIT_BLOCKS, which the owner settled on 24 September 2026 (docs/open-points.md,
// "Visit lengths"), so the site says what FSM books. The area is "Delhi NCR", as the home page has always said, until
// the owner rules on the wording (ADR 0025, item 14): the served pincodes decide where we actually go.

import { VISIT_BLOCKS } from "../../../src/config/scheduling.ts";
import type { VisitType } from "../../../src/config/visit-types.ts";

export const serviceArea = "Delhi NCR";

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
