// The name of a group of a record's rows, above them in the quiet small type: a package's First fit, a hair profile's
// Head. Set in as far as the rows' names, so it stands over them.

import type { ReactNode } from "react";
import styles from "./row-group-title.module.css";

export function RowGroupTitle({
  level = 3,
  id,
  children,
}: {
  /** Its heading's level in the screen's outline. */
  readonly level?: 3 | 4;
  /** For the group it names, by aria-labelledby. */
  readonly id?: string;
  readonly children: ReactNode;
}) {
  const Heading = level === 3 ? "h3" : "h4";
  return (
    <Heading id={id} className={styles.title}>
      {children}
    </Heading>
  );
}
