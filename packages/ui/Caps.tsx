import type { ReactNode } from "react";
import { classes } from "./classes.ts";
import styles from "./caps.module.css";

/** The label's look, for an element Caps does not draw: a legend, a link, a button. */
export const capsLook = (className?: string): string => classes(styles.caps, className);

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
