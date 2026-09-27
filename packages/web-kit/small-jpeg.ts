// A picture re-encoded small in the browser: drawn through a canvas and encoded
// as a JPEG of about 250 KB, so nothing of the original file's metadata
// survives (no location, no device, no time). The technician's camera sends
// each visit photograph this way, the size ADR 0039's R2 budget assumes, and
// the site sends a try-on photograph's small copy this way, which a client
// keeps as their before photo (docs/decisions/0084-a-clients-try-on-is-kept.md).

/** ADR 0039: "each visit's ten photographs, re-encoded on the phone to about 250 KB each". */
export const SMALL_JPEG_BYTES = 250 * 1024;

/** The long edge a picture is first drawn at: enough for a scalp at arm's length, small enough to encode fast. */
export const SMALL_JPEG_LONG_EDGE = 1600;

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
    const canvas = draw(source, width, height, scale);
    for (const quality of QUALITIES) {
      const blob = await encode(canvas, quality);
      const picture = { blob, width: canvas.width, height: canvas.height };
      if (smallest === null || blob.size < smallest.blob.size) smallest = picture;
      if (blob.size <= target) return picture;
    }
    scale *= 0.75;
  }
  if (smallest === null) throw new Error("the picture could not be encoded");
  return smallest;
}
