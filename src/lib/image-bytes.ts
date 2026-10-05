// What an image really is, read from its bytes rather than from its name or
// the Content-Type it arrived with. AILabTools' results are PNG whatever their
// URL says, and Premium rejects a part whose name does not match its bytes
// (docs/reference/ailabtools-api-notes.md, 7.2).

export type ImageType = "image/jpeg" | "image/png";

interface ImageInfo {
  readonly type: ImageType;
  /** Null when the header is damaged. */
  readonly width: number | null;
  readonly height: number | null;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Null for anything that is not a JPEG or a PNG. */
export function inspectImage(bytes: Uint8Array): ImageInfo | null {
  if (PNG_SIGNATURE.every((value, index) => bytes[index] === value)) return { type: "image/png", ...pngSize(bytes) };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { type: "image/jpeg", ...jpegSize(bytes) };
  return null;
}

export function fileExtension(type: ImageType): "png" | "jpg" {
  return type === "image/png" ? "png" : "jpg";
}

/** The type of an image stored under a key fileExtension named: "results/j1.jpg" → "image/jpeg". */
export function typeOfKey(key: string): ImageType {
  return key.endsWith(".png") ? "image/png" : "image/jpeg";
}

type Size = { width: number | null; height: number | null };
const UNKNOWN_SIZE: Size = { width: null, height: null };

/** The first chunk after the signature is IHDR: width and height as 4-byte big-endian numbers. */
function pngSize(bytes: Uint8Array): Size {
  if (bytes.length < 24) return UNKNOWN_SIZE;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunkType = String.fromCharCode(...bytes.subarray(12, 16));
  if (chunkType !== "IHDR") return UNKNOWN_SIZE;
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * Walks the JPEG's segments to the frame header (SOF), which holds the size.
 * Each segment is FF, a marker byte, and a 2-byte length that includes itself.
 */
function jpegSize(bytes: Uint8Array): Size {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return UNKNOWN_SIZE;
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xff) {
      offset += 1; // padding
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2; // markers without a length
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return UNKNOWN_SIZE; // image data or the end, before any frame header

    const length = view.getUint16(offset + 2);
    if (isFrameHeader(marker)) {
      if (offset + 9 > bytes.length) return UNKNOWN_SIZE;
      return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
    }
    offset += 2 + length;
  }
  return UNKNOWN_SIZE;
}

/** SOF0 to SOF15, except DHT (C4), JPG (C8) and DAC (CC), which share the range. */
function isFrameHeader(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}
