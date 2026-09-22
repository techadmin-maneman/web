// Small drawings the islands share: a line icon, and the stage drawing (a head
// with the hair and the thinning zone) used by the try-on and the booking form.

import { HEAD_OUTLINE } from "@maneman/brand/icons";

export function Icon({ path, size, stroke = 1.6 }: { path: string; size: number; stroke?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      stroke-width={stroke}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

export function StageDrawing({ hair, zone, size }: { hair: string; zone: string; size: "large" | "small" }) {
  const [width, height] = size === "large" ? [52, 60] : [44, 50];
  return (
    <svg
      viewBox="0 0 64 74"
      width={width}
      height={height}
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <path d={HEAD_OUTLINE} />
      <path d={hair} stroke-width="1.1" />
      <path d={zone} stroke-width="1.1" stroke-dasharray="2.5 3" />
    </svg>
  );
}
