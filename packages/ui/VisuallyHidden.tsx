import type { ReactNode } from "react";
import styles from "./visually-hidden.module.css";

/** The class alone, for an Astro page that draws its own element: a table's hidden header row. */
export const hiddenLook = styles.hidden;

/** Out of sight on a phone alone (760 px and under), still read out: what a phone's frame says another way. */
export const hiddenOnPhoneLook = styles.hiddenOnPhone;

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
