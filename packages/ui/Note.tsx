// A muted line under a panel's title or beside a form: what a list holds when it holds nothing, what a rule means, or
// who last set it. In from the panel's edge, as the form's other lines are; inside a group of fields, which is already
// in from it, at the group's own edge.

import type { ReactNode } from "react";
import styles from "./note.module.css";

export function Note({
  id,
  role,
  children,
}: {
  readonly id?: string | undefined;
  /** "status" for a line that answers what was just done, so a screen reader says it. */
  readonly role?: "status" | undefined;
  readonly children: ReactNode;
}) {
  return (
    <p className={styles.note} id={id} role={role}>
      {children}
    </p>
  );
}
