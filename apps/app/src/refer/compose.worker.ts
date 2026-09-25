// Composes a client's referral card off the page's thread (docs/prompts/phase2-frontend.md, "Refer": "Run the
// composition in a Worker thread so the tab stays responsive"). Decoding two photographs, drawing them and
// encoding a JPEG takes long enough on a slow phone to freeze the sheet. It answers the card, or null where the
// browser cannot draw off the page (no OffscreenCanvas), and the sheet then uses the house example.

import { MARK, WORDMARK_SMALL } from "@maneman/brand/marks";
import { drawCard } from "./card-draw.ts";
import { CARD_HEIGHT, CARD_WIDTH, viewBoxOf, type CardColours } from "./card-layout.ts";

export interface ComposeRequest {
  readonly before: Blob;
  readonly after: Blob;
  readonly colours: CardColours;
}

/** WhatsApp wants the card under 300 KB; at this quality a 1200 × 630 photograph is well under. */
const QUALITY = 0.82;

async function compose({ before, after, colours }: ComposeRequest): Promise<Blob | null> {
  if (typeof OffscreenCanvas === "undefined") return null;
  const [left, right] = await Promise.all([createImageBitmap(before), createImageBitmap(after)]);
  const canvas = new OffscreenCanvas(CARD_WIDTH, CARD_HEIGHT);
  const context = canvas.getContext("2d");
  if (context === null) return null;
  const lockup = {
    mark: new Path2D(MARK.d),
    markBox: viewBoxOf(MARK.viewBox),
    wordmark: new Path2D(WORDMARK_SMALL.d),
    wordmarkBox: viewBoxOf(WORDMARK_SMALL.viewBox),
  };
  drawCard(context, { before: left, after: right }, lockup, colours);
  left.close();
  right.close();
  return canvas.convertToBlob({ type: "image/jpeg", quality: QUALITY });
}

self.addEventListener("message", (event: MessageEvent<ComposeRequest>) => {
  void compose(event.data)
    .catch(() => null)
    .then((card) => {
      self.postMessage(card);
    });
});
