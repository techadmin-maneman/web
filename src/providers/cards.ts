// A client's referral card, drawn by Cloudflare Images (the IMAGES binding) from their first fit's front
// photographs, as the card's design lays it out (docs/decisions/0048-referrals.md): each photograph cut to its half from the
// top, where a face is, then the gilt rule and the lockup drawn over both from the overlay the house card's script
// makes. On the free plan Images refuses work past 5,000 transformations a month and never bills (docs/runbook.md).
// Locally it only resizes, so a local card is the overlay alone.

import { CARD_OVERLAY_PNG } from "../config/card-overlay.ts";
import { CARD_HEIGHT, HALF_WIDTH, RULE_WIDTH } from "../config/referral-cards.ts";

export interface CardPhotos {
  readonly before: Uint8Array;
  readonly after: Uint8Array;
}

export interface CardComposer {
  /** The card, a JPEG, from the two photographs. */
  compose(photos: CardPhotos): Promise<Uint8Array>;
}

const overlay = Uint8Array.from(atob(CARD_OVERLAY_PNG), (char) => char.charCodeAt(0));

/** An image's bytes as the binding reads them, once. */
const streamOf = (bytes: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });

export function createCardComposer(images: ImagesBinding): CardComposer {
  const half = (photo: Uint8Array) =>
    images.input(streamOf(photo)).transform({ width: HALF_WIDTH, height: CARD_HEIGHT, fit: "cover", gravity: "top" });
  return {
    async compose({ before, after }) {
      const card = await images
        .input(streamOf(overlay))
        .draw(half(before), { left: 0, top: 0 })
        .draw(half(after), { left: HALF_WIDTH + RULE_WIDTH, top: 0 })
        .draw(streamOf(overlay), { left: 0, top: 0 })
        .output({ format: "image/jpeg", quality: 82 });
      return new Uint8Array(await card.response().arrayBuffer());
    },
  };
}
