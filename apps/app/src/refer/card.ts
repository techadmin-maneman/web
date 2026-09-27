// The client's own referral card (design/phase2/Referral and Waitlist, A1), composed on the phone from their
// first fit's front photographs, in a Worker (compose.worker.ts) with board A1's layout (card-layout.ts). The
// photographs never leave the phone except as this card, which goes to the API only when the client shares it
// (docs/decisions/0048-referrals.md).

import { cssToken } from "@maneman/ui/cssToken";
import type { PhotoTimeline } from "../api.ts";
import type { CardColours } from "./card-layout.ts";
import type { ComposeRequest } from "./compose.worker.ts";

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

/** The brand's colours, as the page's stylesheet holds them (packages/brand/tokens.css). */
function cardColours(): CardColours {
  return { ink: cssToken("--ink"), gilt: cssToken("--gilt"), paper: cssToken("--paper") };
}

async function photograph(url: string): Promise<Blob | null> {
  const response = await fetch(url, { credentials: "same-origin" }).catch(() => null);
  return response?.ok === true ? response.blob() : null;
}

/** The Worker's answer: the card, or null if it could not be made. */
function inWorker(request: ComposeRequest): Promise<Blob | null> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL("./compose.worker.ts", import.meta.url), { type: "module" });
    const done = (card: Blob | null) => {
      worker.terminate();
      resolve(card);
    };
    worker.addEventListener("message", (event: MessageEvent<Blob | null>) => {
      done(event.data);
    });
    worker.addEventListener("error", () => {
      done(null);
    });
    worker.postMessage(request);
  });
}

/** The card as a JPEG, or null where the photographs cannot be read or the phone cannot draw it. */
export async function composeCard(pair: FirstFitPair): Promise<Blob | null> {
  const [before, after] = await Promise.all([photograph(pair.before), photograph(pair.after)]);
  if (before === null || after === null) return null;
  return inWorker({ before, after, colours: cardColours() });
}
