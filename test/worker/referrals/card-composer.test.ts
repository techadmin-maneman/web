// The card composer against the Images binding (src/providers/cards.ts). Locally the binding only resizes, and skips
// what is drawn over the first image, so this proves the calls and the card's shape; the drawing itself is
// Cloudflare's, seen on staging.

import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { CARD_OVERLAY_PNG } from "../../../src/config/card-overlay.ts";
import { inspectImage } from "../../../src/lib/image-bytes.ts";
import { createCardComposer } from "../../../src/providers/cards.ts";

/** A real image to stand for each photograph: the overlay itself, which is nobody. */
const photograph = Uint8Array.from(atob(CARD_OVERLAY_PNG), (char) => char.charCodeAt(0));

it("makes a 1200 x 630 JPEG under 300 KB", async () => {
  const card = await createCardComposer(env.IMAGES).compose({ before: photograph, after: photograph });

  expect(inspectImage(card)).toMatchObject({ type: "image/jpeg", width: 1200, height: 630 });
  expect(card.byteLength).toBeLessThan(300 * 1024);
});
