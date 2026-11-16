import { MARK, WORDMARK_SMALL } from "@maneman/brand/marks";
import { classes } from "./classes.ts";
import styles from "./mark.module.css";

/** The brand's mark, in the surrounding text colour; its size is the caller's. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox={MARK.viewBox} aria-hidden="true" focusable="false">
      <path fillRule="evenodd" d={MARK.d} />
    </svg>
  );
}

/** The mark and the name beside it, as the brand kit draws the lockup; read out as the name. */
export function Lockup({ label, className }: { label: string; className?: string }) {
  return (
    <span className={classes(styles.lockup, className)} role="img" aria-label={label}>
      <Mark className={styles.mark} />
      <svg className={styles.wordmark} viewBox={WORDMARK_SMALL.viewBox} aria-hidden="true" focusable="false">
        <path d={WORDMARK_SMALL.d} />
      </svg>
    </span>
  );
}
