// A field: its label, its control, and beneath them a hint and, when the value
// is wrong, what is wrong. The three are tied together for a screen reader --
// the label names the control, the hint and the error describe it, and the
// control is marked invalid while there is an error -- so no screen has to wire
// ids by hand.
//
// The control is the caller's, drawn through `children`, which is given the id
// and the attributes to put on it:
//
//   <Field label={copy.reason} hint={copy.hint}>
//     {(control) => <TextArea {...control} value={reason} onChange={...} />}
//   </Field>
//
// Its look is the ops console's (board C1's reason), with the edge ADR 0025,
// item 36 rules for every field; a caller's own class places it.

import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { classes } from "./classes.ts";
import styles from "./field.module.css";

/** What a field gives its control. */
export interface FieldControl {
  readonly id: string;
  readonly "aria-describedby": string | undefined;
  readonly "aria-invalid": true | undefined;
}

/** The ids of what describes a control, the hint first; none when there is nothing to say. */
function describedBy(hint: string | null, error: string | null): string | undefined {
  const ids = [hint, error].filter((id): id is string => id !== null);
  return ids.length === 0 ? undefined : ids.join(" ");
}

export function Field({
  label,
  hint,
  error,
  className,
  children,
}: {
  readonly label: ReactNode;
  readonly hint?: ReactNode;
  /** What is wrong with the value, said once it is; null or absent while nothing is. */
  readonly error?: ReactNode;
  /** The field's place on its screen. */
  readonly className?: string;
  readonly children: (control: FieldControl) => ReactNode;
}) {
  const id = useId();
  const hintId = hint === undefined ? null : `${id}-hint`;
  const errorId = error === undefined || error === null ? null : `${id}-error`;
  return (
    <div className={className}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {children({
        id,
        "aria-describedby": describedBy(hintId, errorId),
        "aria-invalid": errorId === null ? undefined : true,
      })}
      {hintId !== null && (
        <p className={styles.hint} id={hintId}>
          {hint}
        </p>
      )}
      {errorId !== null && (
        <p className={styles.error} id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}

/** A line of text to type, the tap's height; its width is the caller's. */
export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={classes(styles.box, styles.line, className)} />;
}

/**
 * A figure to type: a count, a price in rupees, a share, its digits lined up. A number box by default; a caller that
 * takes a figure as text, to keep what was typed, says type="text".
 */
export function NumberInput({ className, type = "number", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} type={type} className={classes(styles.box, styles.line, styles.figure, className)} />;
}

/** A day to pick, the whole date shown beside the picker's button. */
export function DateInput({ className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return <input {...rest} type="date" className={classes(styles.box, styles.line, styles.figure, className)} />;
}

/** One of a few, with the one arrow every select in the apps draws. */
export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...rest} className={classes(styles.box, styles.line, styles.select, className)} />;
}

/** More than a line: a reason, an answer to a client. Its height is the caller's; it does not stretch. */
export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={classes(styles.box, styles.area, className)} />;
}

/** A box to tick, with the words that name it beside it. */
export function Checkbox({
  label,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "id"> & { readonly label: ReactNode }) {
  const id = useId();
  return (
    <div className={classes(styles.checkLine, className)}>
      <input {...rest} className={styles.check} type="checkbox" id={id} />
      <label className={styles.checkLabel} htmlFor={id}>
        {label}
      </label>
    </div>
  );
}
