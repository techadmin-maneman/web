// Whether a photo is one AILabTools will take: JPEG or PNG by its bytes, at
// most 5 MB, 200 to 4090 px a side (API notes, sections 3 and 4). The browser
// scales and re-encodes before uploading, so a refusal here is rare. The same
// check holds the small copy a client keeps as their before photo to a JPEG of
// about 250 KB and at most 1600 px a side (docs/decisions/0084-a-clients-try-on-is-kept.md).

import { COPY_LONG_EDGE_PX, MAX_COPY_BYTES, MAX_SIDE_PX, MAX_UPLOAD_BYTES, MIN_SIDE_PX } from "../../config/tryon.ts";
import { inspectImage, type ImageType } from "../../lib/image-bytes.ts";

type PhotoCheck = { readonly ok: true; readonly type: ImageType } | { readonly ok: false; readonly problem: string };

interface Limits {
  readonly name: string;
  readonly maxBytes: number;
  readonly types: readonly ImageType[];
  readonly maxSide: number;
}

const PHOTO: Limits = {
  name: "photo",
  maxBytes: MAX_UPLOAD_BYTES,
  types: ["image/jpeg", "image/png"],
  maxSide: MAX_SIDE_PX,
};
const COPY: Limits = { name: "copy", maxBytes: MAX_COPY_BYTES, types: ["image/jpeg"], maxSide: COPY_LONG_EDGE_PX };

export const checkPhoto = (bytes: Uint8Array): PhotoCheck => check(bytes, PHOTO);
export const checkCopy = (bytes: Uint8Array): PhotoCheck => check(bytes, COPY);

function check(bytes: Uint8Array, limits: Limits): PhotoCheck {
  const { name } = limits;
  if (bytes.byteLength > limits.maxBytes) return { ok: false, problem: `${name} is ${String(bytes.byteLength)} bytes` };
  const info = inspectImage(bytes);
  if (info === null || !limits.types.includes(info.type)) {
    return { ok: false, problem: `${name} is not a ${limits.types.map(typeName).join(" or ")}` };
  }
  const { width, height } = info;
  if (width === null || height === null) return { ok: false, problem: `${name} size unreadable` };
  const inRange = (side: number) => side >= MIN_SIDE_PX && side <= limits.maxSide;
  if (!inRange(width) || !inRange(height)) {
    return { ok: false, problem: `${name} is ${String(width)}x${String(height)} px` };
  }
  return { ok: true, type: info.type };
}

const typeName = (type: ImageType) => (type === "image/png" ? "PNG" : "JPEG");
