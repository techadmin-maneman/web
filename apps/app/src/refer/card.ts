// The client's own referral card (design/phase2/Referral and Waitlist, A1), composed on the phone from their
// first fit's front photographs: the before on the left, the after on the right, one gold rule between them.
// Same crop, same distance; no name, no words, no arrow. The photographs never leave the phone except as this
// card, which goes to the API only when the client shares it (docs/decisions/0048-referrals.md).

import type { PhotoTimeline } from "../api.ts";

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;
const RULE = 6;
/** The brand's gold, as packages/brand/tokens.css holds it. */
const GOLD = "#7a5b24";
const INK = "#16233a";

/** The client's first fit, with a front photograph on each side of it. */
export function firstFitPhotos(timeline: PhotoTimeline): { before: string; after: string } | null {
  const fit = timeline.visits.find((visit) => visit.type === "first_fit");
  const front = (photos: PhotoTimeline["visits"][number]["photos"]["before"]) =>
    photos.find((photo) => photo.angle === "front")?.url ?? null;
  const before = fit === undefined ? null : front(fit.photos.before);
  const after = fit === undefined ? null : front(fit.photos.after);
  return before === null || after === null ? null : { before, after };
}

/** One half of the card: the photograph, cropped to fill, from the top where a face is. */
function drawHalf(context: CanvasRenderingContext2D, image: ImageBitmap, left: number, width: number): void {
  const scale = Math.max(width / image.width, CARD_HEIGHT / image.height);
  const drawn = { width: image.width * scale, height: image.height * scale };
  context.save();
  context.beginPath();
  context.rect(left, 0, width, CARD_HEIGHT);
  context.clip();
  context.drawImage(image, left + (width - drawn.width) / 2, 0, drawn.width, drawn.height);
  context.restore();
}

/** The card as a JPEG, or null where the browser cannot make one. */
export async function composeCard(photos: { before: string; after: string }): Promise<Blob | null> {
  const [before, after] = await Promise.all(
    [photos.before, photos.after].map(async (url) => {
      const response = await fetch(url, { credentials: "same-origin" });
      if (!response.ok) throw new Error("photograph unavailable");
      return createImageBitmap(await response.blob());
    }),
  );
  if (before === undefined || after === undefined) return null;
  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const context = canvas.getContext("2d");
  if (context === null) return null;
  context.fillStyle = INK;
  context.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  const half = (CARD_WIDTH - RULE) / 2;
  drawHalf(context, before, 0, half);
  drawHalf(context, after, half + RULE, half);
  context.fillStyle = GOLD;
  context.fillRect(half, 0, RULE, CARD_HEIGHT);
  before.close();
  after.close();
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(
      (blob) => {
        resolve(blob);
      },
      "image/jpeg",
      0.82,
    );
  });
}
