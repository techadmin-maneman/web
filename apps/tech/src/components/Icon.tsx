/**
 * A line icon in a 24 px box, drawn in the surrounding text colour. The
 * technician board draws its glyphs at a 1.8 stroke, heavier than the client
 * app's for reading in the sun; a stepper's signs are 2 and a ticked box 2.6.
 */
export function Icon({
  d,
  size,
  stroke = 1.8,
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
