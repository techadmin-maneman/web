// Customer Care's times as ops set them (care_times, docs/decisions/0322-care-times.md), which each deploy's build reads
// from its environment (scripts/lib/site-words.ts) and passes in as __MM_CARE_TIMES__ (site/astro.config.ts); a build
// that reads none has the policy's own. The site gives them as its opening hours, every day of the week
// (docs/decisions/0325-search-pages-and-opening-hours.md).

import { clockOf } from "@rules/policy/care-hours.ts";

declare const __MM_CARE_TIMES__: { readonly opens: number; readonly closes: number };

/** When Care open and close, as schema.org writes a time of the day: "09:30", "19:00". */
export const CARE_OPENS = clockOf(__MM_CARE_TIMES__.opens);
export const CARE_CLOSES = clockOf(__MM_CARE_TIMES__.closes);
