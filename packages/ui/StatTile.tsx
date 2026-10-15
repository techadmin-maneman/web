// One figure that matters, large in the serif under its name, the whole tile a link to where it is acted on. A figure
// to act on takes the warning's tone; one to look at, the attention's.
//
//   <StatTile label={copy.overdue} value={4} tone="warning" to="/tasks" />

import { Link } from "./router.tsx";
import { classes } from "./classes.ts";
import styles from "./stat-tile.module.css";

export type StatTone = "plain" | "attention" | "warning";

export function StatTile({
  label,
  value,
  tone = "plain",
  to,
  className,
}: {
  readonly label: string;
  readonly value: string | number;
  readonly tone?: StatTone;
  /** Where the figure is acted on; a tile without one is not a link. */
  readonly to?: string;
  readonly className?: string | undefined;
}) {
  const body = (
    <>
      <span className={styles.label}>{label}</span>
      <span className={classes(styles.value, styles[tone])}>{value}</span>
    </>
  );
  if (to === undefined) return <div className={classes(styles.tile, className)}>{body}</div>;
  return (
    <Link className={classes(styles.tile, styles.link, className)} to={to}>
      {body}
    </Link>
  );
}
