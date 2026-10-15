// The row above a list that narrows it: a search, a few choices, and at its end how many match and the page's tools.
// Its boxes are the desk's height, labelled for a screen reader, and stand on one line where they fit.
//
//   <Toolbar label={copy.narrow} end={<span>{copy.count(12)}</span>}>
//     <SearchInput label={copy.search} value={find} onChange={setFind} />
//   </Toolbar>

import type { ReactNode } from "react";
import { classes } from "./classes.ts";
import styles from "./toolbar.module.css";

export function Toolbar({
  label,
  end,
  className,
  children,
}: {
  /** What the row does, read to a screen reader: "Narrow the list". */
  readonly label: string;
  /** At the row's end: how many match, a way to clear, a download. */
  readonly end?: ReactNode;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}) {
  return (
    <div className={classes(styles.toolbar, className)} role="search" aria-label={label}>
      {children}
      {end !== undefined && <div className={styles.end}>{end}</div>}
    </div>
  );
}
