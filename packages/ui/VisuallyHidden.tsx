import type { ReactNode } from "react";
import styles from "./visually-hidden.module.css";

/**
 * Words for a screen reader alone: a heading the design does not draw, a
 * status line read out as it changes, a legend for a group of choices.
 */
export function VisuallyHidden({
  as: Tag = "span",
  id,
  role,
  children,
}: {
  as?: "span" | "p" | "h2" | "legend";
  id?: string;
  role?: "status";
  children: ReactNode;
}) {
  return (
    <Tag className={styles.hidden} id={id} role={role}>
      {children}
    </Tag>
  );
}
