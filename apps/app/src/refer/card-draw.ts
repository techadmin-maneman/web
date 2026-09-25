// Drawing the referral card on a canvas, with board A1's layout (card-layout.ts): both photographs cropped to
// fill their halves from the top, where a face is, the gilt rule between them, and the lockup over the after.

import {
  CARD_HEIGHT,
  CARD_WIDTH,
  HALF_WIDTH,
  lockupPlaces,
  RULE_WIDTH,
  type CardColours,
  type Place,
  type ViewBox,
} from "./card-layout.ts";

/** The drawings the lockup is made of, as paths, and the box each is drawn in (packages/brand/marks.ts). */
export interface LockupPaths {
  readonly mark: Path2D;
  readonly markBox: ViewBox;
  readonly wordmark: Path2D;
  readonly wordmarkBox: ViewBox;
}

type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Photo = CanvasImageSource & { readonly width: number; readonly height: number };

/** Draws the whole card: both halves, the rule, and the lockup over the after. */
export function drawCard(
  context: Context,
  photos: { readonly before: Photo; readonly after: Photo },
  lockup: LockupPaths,
  colours: CardColours,
): void {
  context.fillStyle = colours.ink;
  context.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  drawHalf(context, photos.before, 0);
  drawHalf(context, photos.after, HALF_WIDTH + RULE_WIDTH);
  context.fillStyle = colours.gilt;
  context.fillRect(HALF_WIDTH, 0, RULE_WIDTH, CARD_HEIGHT);

  const places = lockupPlaces();
  drawDrawing(context, lockup.mark, lockup.markBox, places.mark, colours.gilt, "evenodd");
  drawDrawing(context, lockup.wordmark, lockup.wordmarkBox, places.wordmark, colours.paper, "nonzero");
}

/** One half: the photograph, cropped to fill, from the top where a face is. */
function drawHalf(context: Context, photo: Photo, left: number): void {
  const scale = Math.max(HALF_WIDTH / photo.width, CARD_HEIGHT / photo.height);
  const width = photo.width * scale;
  const height = photo.height * scale;
  context.save();
  context.beginPath();
  context.rect(left, 0, HALF_WIDTH, CARD_HEIGHT);
  context.clip();
  context.drawImage(photo, left + (HALF_WIDTH - width) / 2, 0, width, height);
  context.restore();
}

/** A brand drawing scaled from its own box into its place, whole and centred, as an SVG draws one by default. */
function drawDrawing(
  context: Context,
  path: Path2D,
  box: ViewBox,
  place: Place,
  colour: string,
  rule: CanvasFillRule,
): void {
  const scale = Math.min(place.width / box.width, place.height / box.height);
  context.save();
  context.translate(
    place.left + (place.width - box.width * scale) / 2,
    place.top + (place.height - box.height * scale) / 2,
  );
  context.scale(scale, scale);
  context.translate(-box.x, -box.y);
  context.fillStyle = colour;
  context.fill(path, rule);
  context.restore();
}
