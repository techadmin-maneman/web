// Over a list with rows chosen (./useRowSelection.ts): how many, what can be done to them all, and a way to let them go.
//
//   <SelectionBar count={3} onClear={selection.clear}>
//     <Button size="small" onClick={takeAll}>{copy.take(3)}</Button>
//   </SelectionBar>

import type { ReactNode } from "react";
import { TextButton } from "./TextLink.tsx";
import { tables } from "./words.ts";
import styles from "./selection-bar.module.css";

export function SelectionBar({
  count,
  onClear,
  children,
}: {
  readonly count: number;
  readonly onClear: () => void;
  /** What can be done to every row chosen. */
  readonly children: ReactNode;
}) {
  return (
    <div className={styles.bar} role="group" aria-label={tables.chosen(count)}>
      <span className={styles.count} aria-live="polite">
        {tables.chosen(count)}
      </span>
      <div className={styles.actions}>{children}</div>
      <TextButton onClick={onClear}>{tables.clearChosen}</TextButton>
    </div>
  );
}
