import { MARK } from "@maneman/brand/marks";

/** The brand's mark, in the surrounding text colour; its size is the caller's. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox={MARK.viewBox} aria-hidden="true" focusable="false">
      <path fillRule="evenodd" d={MARK.d} />
    </svg>
  );
}
