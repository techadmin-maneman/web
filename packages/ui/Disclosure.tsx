// More, folded until asked for: a question and its answer, or a section's detail. The browser's own details and
// summary, in the apps' look, so the keyboard and a screen reader work as they expect. The site's pages draw their
// own details element in the ruled look, a list's entries each a row with a plus that turns to a minus when open.

import type { ReactNode } from "react";
import { classes } from "./classes.ts";
import styles from "./disclosure.module.css";

export function Disclosure({
  summary,
  children,
  open,
  className,
  summaryClassName,
}: {
  readonly summary: ReactNode;
  readonly children: ReactNode;
  readonly open?: boolean;
  readonly className?: string | undefined;
  /** The summary's place, where the screen sets it apart: its own margin or type. */
  readonly summaryClassName?: string;
}) {
  return (
    <details className={classes(styles.disclosure, className)} open={open}>
      <summary className={classes(styles.summary, summaryClassName)}>{summary}</summary>
      {children}
    </details>
  );
}

/** The ruled look's classes: the details element, its summary, the sign's drawing, and the plus's upright stroke. */
export const ruledDisclosureLook = {
  details: styles.ruled,
  summary: styles.ruledSummary,
  sign: styles.sign,
  upright: styles.upright,
} as const;
