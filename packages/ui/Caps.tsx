import type { ReactNode } from "react";
import { classes } from "./classes.ts";
import styles from "./caps.module.css";

/** The label's look, for an element Caps does not draw: a legend, a link, a button. */
export const capsLook = (className?: string): string => classes(styles.caps, className);

/**
 * A badge's look: a state, "Prepaid" or "At visit", in small capitals beside what it is about. Brass on paper, muted on
 * ink, or the paper itself on ink for the job in hand. The caller's class sets its place alone.
 */
export const badgeLook = (tone: "brass" | "muted" | "onInk", className?: string): string =>
  classes(styles.caps, styles.badge, styles[tone], className);

/**
 * The boards' label: the serif in small capitals, spaced out. It names a
 * group or a state -- "Your next visit", "Leave", "Prepaid" -- and is never
 * the sans in capitals. Its size, colour and place are the caller's class.
 */
export function Caps({
  as: Tag = "span",
  id,
  className,
  children,
}: {
  as?: "span" | "p" | "h2" | "h3" | "dt" | "th";
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag className={classes(styles.caps, className)} id={id}>
      {children}
    </Tag>
  );
}
