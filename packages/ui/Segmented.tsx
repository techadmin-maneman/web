// One view of a few, side by side in one track: the chosen one raised out of it. For a switch between ways of showing
// the same thing, as a day or a week, or a reply or a note; a filter with counts is a ToggleButton.
//
//   <Segmented label="Show" options={[["day", "Day"], ["week", "Week"]]} value={view} onChange={setView} />
//
// An option may carry how many it holds, boxed beside its words: ["issues", "Issues", 2].

import { classes } from "./classes.ts";
import styles from "./segmented.module.css";

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  /** What the choice is, read out. */
  readonly label: string;
  /** Each option's value and its words, in order, and how many it holds where that is worth a glance. */
  readonly options: readonly (readonly [T, string] | readonly [T, string, number])[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly className?: string | undefined;
}) {
  return (
    <div className={classes(styles.track, className)} role="radiogroup" aria-label={label}>
      {options.map(([each, words, count]) => (
        <button
          key={each}
          type="button"
          role="radio"
          aria-checked={each === value}
          className={styles.segment}
          onClick={() => {
            onChange(each);
          }}
        >
          {words}
          {count !== undefined && count > 0 && <span className={styles.count}>{count}</span>}
        </button>
      ))}
    </div>
  );
}
