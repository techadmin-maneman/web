// The client's own referral card (design/phase2/Referral and Waitlist) is made by the API from their first fit's
// front photographs (docs/decisions/0048-referrals.md). The phone only finds those photographs, to know a card of
// their own can be offered and to show them before it is made.

import type { PhotoTimeline } from "../api.ts";

export interface FirstFitPair {
  readonly before: string;
  readonly after: string;
}

/** The client's first fit, with a front photograph on each side of it. */
export function firstFitPhotos(timeline: PhotoTimeline): FirstFitPair | null {
  const fit = timeline.visits.find((visit) => visit.type === "first_fit");
  const front = (photos: PhotoTimeline["visits"][number]["photos"]["before"]) =>
    photos.find((photo) => photo.angle === "front")?.url ?? null;
  const before = fit === undefined ? null : front(fit.photos.before);
  const after = fit === undefined ? null : front(fit.photos.after);
  return before === null || after === null ? null : { before, after };
}
