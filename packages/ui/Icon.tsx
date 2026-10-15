import { ICON_SIZES, ICON_STROKES, type IconSize, type IconWeight } from "@maneman/brand/icons";

/**
 * A line icon in a 24 px box, drawn in the surrounding text colour, at one of the set's sizes. The technician app
 * draws the heavy stroke, for reading in the sun.
 */
export function Icon({
  d,
  size,
  weight = "regular",
  className,
}: {
  d: string;
  size: IconSize;
  weight?: IconWeight;
  className?: string;
}) {
  const px = ICON_SIZES[size];
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={px}
      height={px}
      fill="none"
      stroke="currentColor"
      strokeWidth={ICON_STROKES[weight]}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}
