// The bar at the foot of a screen that holds its actions (docs/prompts/tech-redesign.md, "Spacing"): under a
// hairline, clear of a phone's home bar. A button that cannot be used yet always has one line above it saying what is
// missing ("2 left", "Pick a reason"), and that line describes the button to a screen reader.

import { useId, type ReactNode } from "react";
import { classes } from "./classes.ts";
import styles from "./action-bar.module.css";

export function ActionBar({
  helper,
  className,
  children,
}: {
  /** What is missing before the action can be taken; none once it can. */
  readonly helper?: ReactNode;
  readonly className?: string | undefined;
  /** The actions, side by side; given the helper's id, for each button it describes. */
  readonly children: ReactNode | ((helperId: string | undefined) => ReactNode);
}) {
  const id = useId();
  const helperId = helper === undefined || helper === null ? undefined : `${id}-helper`;
  return (
    <div className={classes(styles.bar, className)}>
      {helperId !== undefined && (
        <p className={styles.helper} id={helperId}>
          {helper}
        </p>
      )}
      <div className={styles.actions}>{typeof children === "function" ? children(helperId) : children}</div>
    </div>
  );
}
