// The visitor's photograph, made ready in the browser before it is uploaded,
// as the AILabTools harness does it: fit within 4090 px, re-encode as JPEG at
// 0.92, and shrink further until it is under 5 MB. Drawing it through a canvas
// drops its EXIF, the GPS location included. It is kept in memory only. Under a
// notice that keeps a client's try-on, a small copy of about 250 KB is made
// too, as the technician's camera makes a visit photograph (ADR 0084).

import { smallJpeg } from "@maneman/web-kit/small-jpeg";
import {
  MAX_COPY_BYTES,
  MAX_SIDE_PX,
  MAX_UPLOAD_BYTES,
  MIN_SIDE_PX,
  type HairColor,
} from "../../../src/config/tryon.ts";
import { DETECTOR_SIDE, detectHairColour } from "./hair-colour.ts";

const QUALITY = 0.92;
/** Each retry over 5 MB shrinks the photo by this much, and stops at this size. */
const SHRINK = 0.85;
const SMALLEST_SIDE = 220;

/** The file is not an image the browser can read, or it is too small for the API. */
export class PhotoRejected extends Error {}

export interface PreparedPhoto {
  readonly blob: Blob;
  readonly hairColor: HairColor;
  /** The small copy a client keeps as their before photo; null when none is asked for, or none came small enough. */
  readonly copy: Blob | null;
}

/** The size that fits within `max` on the longer side, keeping the shape. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

function canvasOf(image: ImageBitmap, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")?.drawImage(image, 0, 0, width, height);
  return canvas;
}

function jpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob === null) reject(new Error("the photograph could not be encoded"));
        else resolve(blob);
      },
      "image/jpeg",
      QUALITY,
    );
  });
}

/** A copy the API will keep: at most 250 KB, or none. */
async function smallCopy(image: ImageBitmap): Promise<Blob | null> {
  const copy = await smallJpeg(image, image.width, image.height, MAX_COPY_BYTES);
  return copy.blob.size <= MAX_COPY_BYTES ? copy.blob : null;
}

/** Resizes, re-encodes and reads the hair colour, and makes the small copy when asked. Throws PhotoRejected if the API could not use it. */
export async function preparePhoto(file: Blob, withCopy: boolean): Promise<PreparedPhoto> {
  const image = await createImageBitmap(file).catch(() => {
    throw new PhotoRejected("the file is not an image this browser can read");
  });
  try {
    if (Math.min(image.width, image.height) < MIN_SIDE_PX) throw new PhotoRejected("the photograph is too small");
    let size = fitWithin(image.width, image.height, MAX_SIDE_PX);
    let blob = await jpeg(canvasOf(image, size.width, size.height));
    while (blob.size > MAX_UPLOAD_BYTES && Math.min(size.width, size.height) >= SMALLEST_SIDE) {
      size = { width: Math.round(size.width * SHRINK), height: Math.round(size.height * SHRINK) };
      blob = await jpeg(canvasOf(image, size.width, size.height));
    }

    const small = fitWithin(image.width, image.height, DETECTOR_SIDE);
    const pixels = canvasOf(image, small.width, small.height)
      .getContext("2d")
      ?.getImageData(0, 0, small.width, small.height).data;
    const hairColor = pixels === undefined ? "unknown" : detectHairColour(pixels, small.width, small.height);

    const copy = withCopy ? await smallCopy(image) : null;
    return { blob, hairColor, copy };
  } finally {
    image.close();
  }
}
