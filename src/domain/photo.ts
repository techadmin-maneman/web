// Whether a photo is one AILabTools will take: JPEG or PNG by its bytes, at
// most 5 MB, 200 to 4090 px a side (API notes, sections 3 and 4). The browser
// scales and re-encodes before uploading, so a refusal here is rare.

import { MAX_SIDE_PX, MAX_UPLOAD_BYTES, MIN_SIDE_PX } from "../config/tryon.ts";
import { inspectImage, type ImageType } from "../lib/image-bytes.ts";

export type PhotoCheck =
  { readonly ok: true; readonly type: ImageType } | { readonly ok: false; readonly problem: string };

export function checkPhoto(bytes: Uint8Array): PhotoCheck {
  if (bytes.byteLength > MAX_UPLOAD_BYTES) return { ok: false, problem: `photo is ${String(bytes.byteLength)} bytes` };
  const info = inspectImage(bytes);
  if (info === null) return { ok: false, problem: "photo is not a JPEG or PNG" };
  const { width, height } = info;
  if (width === null || height === null) return { ok: false, problem: "photo size unreadable" };
  const inRange = (side: number) => side >= MIN_SIDE_PX && side <= MAX_SIDE_PX;
  if (!inRange(width) || !inRange(height))
    return { ok: false, problem: `photo is ${String(width)}x${String(height)} px` };
  return { ok: true, type: info.type };
}
