// The navigation on a phone: a bar on the ink across the foot of the window, a tab each, an icon over its name with
// how many wait there, as SideNav's entries carry. The app draws it where SideNav is off the page.
//
//   <TabBar label={copy.title}>
//     <TabBarItem to="/tasks" icon={GLYPHS.tasks} name="Tasks" current count={8} urgent />
//   </TabBar>

import type { ReactNode } from "react";
import { classes } from "./classes.ts";
import { Icon } from "./Icon.tsx";
import { Link } from "./router.tsx";
import styles from "./tab-bar.module.css";

export function TabBar({
  label,
  className,
  children,
}: {
  readonly label: string;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}) {
  return (
    <nav className={classes(styles.bar, className)} aria-label={label}>
      <ul className={styles.tabs}>{children}</ul>
    </nav>
  );
}

export function TabBarItem({
  to,
  icon,
  name,
  current,
  count,
  urgent = false,
  label,
}: {
  readonly to: string;
  readonly icon: string;
  readonly name: string;
  readonly current: boolean;
  /** How many wait there; none for a tab nothing waits in. */
  readonly count?: number | undefined;
  /** Some of them are overdue. */
  readonly urgent?: boolean;
  /** Its name with its count, read out, where the count alone would not say what it counts. */
  readonly label?: string | undefined;
}) {
  return (
    <li className={styles.cell}>
      <Link className={styles.tab} to={to} current={current} label={label}>
        <span className={styles.icon}>
          <Icon d={icon} size="md" />
          {count !== undefined && count > 0 && <span className={urgent ? styles.urgent : styles.count}>{count}</span>}
        </span>
        <span className={styles.name}>{name}</span>
      </Link>
    </li>
  );
}
