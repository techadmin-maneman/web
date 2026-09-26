import { ICON_STROKE } from "@maneman/brand/icons";

/**
 * A line icon in a 24 px box, drawn in the surrounding text colour. The icon
 * set is drawn at a 1.6 stroke; the technician board draws heavier ones for
 * reading in the sun, which it passes as `stroke`.
 */
export function Icon({
  d,
  size,
  stroke = ICON_STROKE,
  className,
}: {
  d: string;
  size: number;
  stroke?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}
