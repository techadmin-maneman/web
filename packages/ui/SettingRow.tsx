// One setting on a line of its own: its name at the left, its one box at the right with the unit after it, and what is
// wrong beneath the box. For a person who may only look, SettingValue draws the name beside the value, with no box.
//
//   <SettingRow label={copy.radius} unit={copy.metres} error={error}>
//     {(control) => <NumberInput {...control} width="figure" value={text} onChange={…} />}
//   </SettingRow>

import type { ReactNode } from "react";
import { Field, type FieldControl } from "./Field.tsx";
import { classes } from "./classes.ts";
import styles from "./setting-row.module.css";

export function SettingRow({
  label,
  unit,
  error,
  id,
  className,
  children,
}: {
  readonly label: string;
  /** What the figure counts, after the box: "minutes". */
  readonly unit?: string | undefined;
  readonly error?: ReactNode;
  /** The row's id, which a link to this setting names. */
  readonly id?: string | undefined;
  readonly className?: string | undefined;
  readonly children: (control: FieldControl) => ReactNode;
}) {
  return (
    <div className={classes(styles.row, className)} id={id} tabIndex={id === undefined ? undefined : -1}>
      <Field label={label} error={error} className={styles.field} look={{ label: styles.label, error: styles.error }}>
        {(control) => (
          <div className={styles.control}>
            {children(control)}
            {unit !== undefined && <span className={styles.unit}>{unit}</span>}
          </div>
        )}
      </Field>
    </div>
  );
}

export function SettingValue({
  label,
  value,
  id,
  className,
}: {
  readonly label: string;
  /** The value as it reads, its unit with it: "200 metres". */
  readonly value: ReactNode;
  readonly id?: string | undefined;
  readonly className?: string | undefined;
}) {
  return (
    <div className={classes(styles.row, className)} id={id} tabIndex={id === undefined ? undefined : -1}>
      <div className={styles.field}>
        <span className={styles.label}>{label}</span>
        <span className={styles.value}>{value}</span>
      </div>
    </div>
  );
}
