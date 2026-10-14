// The stage drawing the islands share: a head with the hair and the thinning zone, used by the try-on and the
// booking form. A line icon is the shared Icon's (@maneman/ui/Icon).

import { DRAWING_STROKES, HEAD_OUTLINE } from "@maneman/brand/icons";

export function StageDrawing({ hair, zone, size }: { hair: string; zone: string; size: "large" | "small" }) {
  const [width, height] = size === "large" ? [52, 60] : [44, 50];
  return (
    <svg
      viewBox="0 0 64 74"
      width={width}
      height={height}
      fill="none"
      stroke="currentColor"
      stroke-width={DRAWING_STROKES.outline}
      stroke-linecap="round"
      aria-hidden="true"
    >
      <path d={HEAD_OUTLINE} />
      <path d={hair} stroke-width={DRAWING_STROKES.detail} />
      <path d={zone} stroke-width={DRAWING_STROKES.detail} stroke-dasharray="2.5 3" />
    </svg>
  );
}
