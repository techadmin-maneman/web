// A picture re-encoded small in the browser: drawn through a canvas and encoded
// as a JPEG of about 250 KB, so nothing of the original file's metadata
// survives (no location, no device, no time). The technician's camera sends
// each visit photograph this way, the size ADR 0039's R2 budget assumes, and
// the site sends a try-on photograph's small copy this way, which a client
// keeps as their before photo (docs/decisions/0084-a-clients-try-on-is-kept.md).
// The camera also sends a thumbnail of each photograph, for the client app's
// rows (docs/decisions/0093-the-storage-meter.md).

/** ADR 0039: "each visit's ten photographs, re-encoded on the phone to about 250 KB each". */
export const SMALL_JPEG_BYTES = 250 * 1024;

/** The long edge a picture is first drawn at: enough for a scalp at arm's length, small enough to encode fast. */
export const SMALL_JPEG_LONG_EDGE = 1600;

/**
 * A thumbnail's short edge. The client app's rows are five cells of about 73 px by 97 px at most, and 300 px fills
 * one at three device pixels to one whatever the photograph's shape.
 */
export const THUMBNAIL_SHORT_EDGE = 300;
/** What a thumbnail is encoded to; the API takes up to twice this. */
export const THUMBNAIL_BYTES = 32 * 1024;

/** Tried in turn until the picture is at or under the target. */
const QUALITIES = [0.82, 0.72, 0.62, 0.52, 0.42] as const;

export interface SmallJpeg {
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
}

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob === null) reject(new Error("the picture could not be encoded"));
        else resolve(blob);
      },
      "image/jpeg",
      quality,
    );
  });
}

/** The picture drawn at `scale`, as a canvas the same shape as the source. */
function draw(source: CanvasImageSource, width: number, height: number, scale: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("this browser has no 2d canvas");
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** A still of the source, at most SMALL_JPEG_LONG_EDGE on its long side, to encode more than once from one frame. */
export function still(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  return draw(source, width, height, Math.min(1, SMALL_JPEG_LONG_EDGE / Math.max(width, height)));
}

/** The canvas at the first quality that comes in at or under the target, else at the smallest tried. */
async function encodeUnder(canvas: HTMLCanvasElement, target: number): Promise<{ picture: SmallJpeg; fits: boolean }> {
  let smallest: SmallJpeg | null = null;
  for (const quality of QUALITIES) {
    const picture = { blob: await encode(canvas, quality), width: canvas.width, height: canvas.height };
    if (picture.blob.size <= target) return { picture, fits: true };
    if (smallest === null || picture.blob.size < smallest.blob.size) smallest = picture;
  }
  if (smallest === null) throw new Error("the picture could not be encoded");
  return { picture: smallest, fits: false };
}

/**
 * The picture as a JPEG at or about the target size. Quality comes down first,
 * then the picture itself, so a close-up of a scalp stays readable. When
 * nothing tried is under the target, the smallest of what was tried.
 */
export async function smallJpeg(
  source: CanvasImageSource,
  width: number,
  height: number,
  target: number = SMALL_JPEG_BYTES,
): Promise<SmallJpeg> {
  let scale = Math.min(1, SMALL_JPEG_LONG_EDGE / Math.max(width, height));
  let smallest: SmallJpeg | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const tried = await encodeUnder(draw(source, width, height, scale), target);
    if (tried.fits) return tried.picture;
    if (smallest === null || tried.picture.blob.size < smallest.blob.size) smallest = tried.picture;
    scale *= 0.75;
  }
  if (smallest === null) throw new Error("the picture could not be encoded");
  return smallest;
}

/** The picture as a thumbnail: THUMBNAIL_SHORT_EDGE on its short side, never larger than it is. */
export async function thumbnailJpeg(source: CanvasImageSource, width: number, height: number): Promise<SmallJpeg> {
  const scale = Math.min(1, THUMBNAIL_SHORT_EDGE / Math.min(width, height));
  return (await encodeUnder(draw(source, width, height, scale), THUMBNAIL_BYTES)).picture;
}
