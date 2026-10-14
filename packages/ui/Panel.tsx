// The ops console's panel (design/phase2/Ops Console, the Referrals review queue,
// and every queue drawn after it): a bordered section headed by its title in
// the serif, with how many it holds at the right, and what it holds beneath.

import type { ReactNode, Ref, RefObject } from "react";
import { classes } from "./classes.ts";
import styles from "./panel.module.css";
import { typeLook } from "./type.ts";
import { useFocusOnMount } from "./useFocusOnMount.ts";

export function Panel({
  id,
  titleId,
  title,
  count,
  opened = false,
  headingRef,
  actions,
  className,
  ref,
  children,
}: {
  /** The section's id, which a row's button that opens it names (useRowPanel). */
  readonly id?: string | undefined;
  /** The heading's id, which names the section. */
  readonly titleId: string;
  readonly title: string;
  /** How many it holds, as a queue says how many wait; none for a panel that is not a list. */
  readonly count?: number;
  /** Opened beneath a list by one of its rows: its heading takes the keyboard as it draws. */
  readonly opened?: boolean;
  /** For a queue whose heading takes the keyboard once a row is decided and leaves it. */
  readonly headingRef?: RefObject<HTMLHeadingElement | null>;
  /** What the head holds beside the title: a way to download the list, say. */
  readonly actions?: ReactNode;
  readonly className?: string | undefined;
  /** The section, for a panel that scrolls itself into view. */
  readonly ref?: Ref<HTMLElement>;
  readonly children: ReactNode;
}) {
  const arrived = useFocusOnMount<HTMLHeadingElement>();
  const heading = headingRef ?? (opened ? arrived : undefined);
  return (
    <section className={classes(styles.panel, className)} id={id} aria-labelledby={titleId} ref={ref}>
      <div className={styles.head}>
        <h2
          className={typeLook("title-3", styles.title)}
          id={titleId}
          ref={heading}
          tabIndex={heading === undefined ? undefined : -1}
        >
          {title}
        </h2>
        {count !== undefined && <span className={styles.count}>{count}</span>}
        {actions}
      </div>
      {children}
    </section>
  );
}
