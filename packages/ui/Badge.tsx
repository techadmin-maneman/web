// A state beside what it is about, "Overdue", "Held", "Paid", in its tone: the one look every status takes. The tones
// are the status roles (packages/brand/tokens.css), so a badge follows its ground and the console's theme.
//
//   <Badge tone="warning">{copy.overdue}</Badge>

import type { ReactNode } from "react";
import { classes } from "./classes.ts";
import styles from "./badge.module.css";

/**
 * neutral: nothing to do; done: finished; attention: to look at; warning: to act on, as overdue or low; error: what
 * went wrong or was refused.
 */
export type BadgeTone = "neutral" | "done" | "attention" | "warning" | "error";

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  readonly tone?: BadgeTone;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}) {
  return <span className={classes(styles.badge, styles[tone], className)}>{children}</span>;
}
