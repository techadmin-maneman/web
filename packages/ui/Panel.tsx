// The ops console's panel (design/phase2/Ops Console, the Referrals review queue,
// and every queue drawn after it): a bordered section headed by its title in
// the serif, with how many it holds at the right, and what it holds beneath.

import type { ReactNode, RefObject } from "react";
import { classes } from "./classes.ts";
import styles from "./panel.module.css";

export function Panel({
  titleId,
  title,
  count,
  headingRef,
  actions,
  className,
  children,
}: {
  /** The heading's id, which names the section. */
  readonly titleId: string;
  readonly title: string;
  /** How many it holds, as a queue says how many wait; none for a panel that is not a list. */
  readonly count?: number;
  /** For a queue whose heading takes the keyboard once a row is decided and leaves it. */
  readonly headingRef?: RefObject<HTMLHeadingElement | null>;
  /** What the head holds beside the title: a way to download the list, say. */
  readonly actions?: ReactNode;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <section className={classes(styles.panel, className)} aria-labelledby={titleId}>
      <div className={styles.head}>
        <h2 className={styles.title} id={titleId} ref={headingRef} tabIndex={headingRef === undefined ? undefined : -1}>
          {title}
        </h2>
        {count !== undefined && <span className={styles.count}>{count}</span>}
        {actions}
      </div>
      {children}
    </section>
  );
}
