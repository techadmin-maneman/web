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
// Its look is the ops console's reason field, with the edge ADR 0025,
// item 36 rules for every field; a caller's own class places it.

import {
  useId,
  type InputHTMLAttributes,
  type Ref,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { capsLook } from "./Caps.tsx";
import { Icon } from "./Icon.tsx";
import { classes } from "./classes.ts";
import { VisuallyHidden } from "./VisuallyHidden.tsx";
import list from "./choice-list.module.css";
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
  onInk = false,
  className,
  children,
}: {
  readonly label: ReactNode;
  readonly hint?: ReactNode;
  /** What is wrong with the value, said once it is; null or absent while nothing is. */
  readonly error?: ReactNode;
  /** On the ink, as every technician app screen is: its words in the ink's own muted tone. */
  readonly onInk?: boolean;
  /** The field's place on its screen. */
  readonly className?: string;
  readonly children: (control: FieldControl) => ReactNode;
}) {
  const id = useId();
  const hintId = hint === undefined ? null : `${id}-hint`;
  const errorId = error === undefined || error === null ? null : `${id}-error`;
  return (
    <div className={classes(onInk && styles.inkWords, className)}>
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

/**
 * A box's height, which each app sets (--field-height, ./base.css): the tap's, or compact inside a table row, which
 * keeps the row at its height. On the ink, as the technician app's screens are, its edge and words are the ink's.
 */
interface Sized {
  readonly compact?: boolean;
  readonly onInk?: boolean;
}

const lineOf = ({ compact, onInk }: Sized) =>
  classes(compact === true ? styles.compact : styles.line, onInk === true && styles.onInk);

/** A line of text to type, the app's height; its width is the caller's. An icon may stand at its start. */
export function TextInput({
  className,
  compact,
  onInk,
  icon,
  ref,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & Sized & { readonly icon?: string; readonly ref?: Ref<HTMLInputElement> }) {
  const input = <input {...rest} ref={ref} className={classes(styles.box, lineOf({ compact, onInk }), className)} />;
  if (icon === undefined) return input;
  return (
    <div className={styles.withIcon}>
      <Icon className={styles.icon} d={icon} size={21} />
      {input}
    </div>
  );
}

/**
 * A figure to type: a count, a price in rupees, a share, its digits lined up. A number box by default; a caller that
 * takes a figure as text, to keep what was typed, says type="text".
 */
export function NumberInput({
  className,
  type = "number",
  compact,
  onInk,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & Sized) {
  return (
    <input
      {...rest}
      type={type}
      className={classes(styles.box, lineOf({ compact, onInk }), styles.figure, className)}
    />
  );
}

/** A day to pick, the whole date shown beside the picker's button. */
export function DateInput({
  className,
  compact,
  onInk,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & Sized) {
  return (
    <input
      {...rest}
      type="date"
      className={classes(styles.box, lineOf({ compact, onInk }), styles.figure, className)}
    />
  );
}

/** One of a few, with the one arrow every select in the apps draws. */
export function Select({ className, compact, onInk, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & Sized) {
  return <select {...rest} className={classes(styles.box, lineOf({ compact, onInk }), styles.select, className)} />;
}

/** A label of its own, for a control a `Field` cannot hold: one beside another in a row, or named by a table's head. */
export function Label({
  htmlFor,
  onInk = false,
  className,
  children,
}: {
  readonly htmlFor: string;
  readonly onInk?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <label className={classes(styles.label, onInk && styles.labelOnInk, className)} htmlFor={htmlFor}>
      {children}
    </label>
  );
}

/** More than a line: a reason, an answer to a client. Its height is the caller's; it does not stretch. */
export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={classes(styles.box, styles.area, className)} />;
}

/**
 * A box to tick, with the words that name it beside it; or, with no `label`, the box alone, named by its aria-label,
 * as in a table's row.
 */
export function Checkbox({
  label,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "id"> & { readonly label?: ReactNode }) {
  const id = useId();
  if (label === undefined) return <input {...rest} className={classes(styles.check, className)} type="checkbox" />;
  return (
    <div className={classes(styles.checkLine, className)}>
      <input {...rest} className={styles.check} type="checkbox" id={id} />
      <label className={styles.checkLabel} htmlFor={id}>
        {label}
      </label>
    </div>
  );
}

/** One of a few to choose between, with the words that name it beside it; a `ChoiceGroup` holds the few. */
export function Radio({
  label,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "id"> & { readonly label: ReactNode }) {
  const id = useId();
  return (
    <div className={classes(styles.checkLine, className)}>
      <input {...rest} className={styles.check} type="radio" id={id} />
      <label className={styles.checkLabel} htmlFor={id}>
        {label}
      </label>
    </div>
  );
}

/**
 * How a fieldset's legend reads: a field's small label, a section's title, the boards' small capitals, or said to a
 * screen reader alone where the box inside already shows the name.
 */
export type LegendLook = "label" | "title" | "caps" | "hidden";

function LegendOf({ look, children }: { readonly look: LegendLook; readonly children: ReactNode }) {
  if (look === "hidden") return <VisuallyHidden as="legend">{children}</VisuallyHidden>;
  if (look === "caps") return <legend className={capsLook(styles.legendCaps)}>{children}</legend>;
  return <legend className={look === "title" ? styles.legendTitle : styles.legend}>{children}</legend>;
}

/** Fields that belong together under one name: a fieldset and its legend. */
export function Fieldset({
  legend,
  legendLook = "label",
  disabled,
  className,
  children,
}: {
  readonly legend: ReactNode;
  readonly legendLook?: LegendLook;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <fieldset className={classes(styles.group, className)} disabled={disabled}>
      <LegendOf look={legendLook}>{legend}</LegendOf>
      {children}
    </fieldset>
  );
}

/** Boxes or choices that answer one question, named by it: a fieldset and its legend, with a hint beneath. */
export function ChoiceGroup({
  legend,
  legendLook = "label",
  hint,
  disabled,
  ruled = false,
  inline = false,
  className,
  children,
}: {
  readonly legend: ReactNode;
  readonly legendLook?: LegendLook;
  /** Each choice a row of the tap's height over a rule, as a list of reasons is drawn. */
  readonly ruled?: boolean;
  /** The choices side by side, wrapping, where they are few and short. */
  readonly inline?: boolean;
  readonly hint?: ReactNode;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const id = useId();
  return (
    <fieldset
      className={classes(styles.group, className)}
      disabled={disabled}
      aria-describedby={hint === undefined ? undefined : id}
    >
      <LegendOf look={legendLook}>{legend}</LegendOf>
      <div className={classes(styles.choices, ruled && list.ruled, inline && styles.inline)}>{children}</div>
      {hint !== undefined && (
        <p className={styles.hint} id={id}>
          {hint}
        </p>
      )}
    </fieldset>
  );
}

/** A file to choose, as a photograph or a supplier's invoice; the browser's own chooser, in the field's box. */
export function FileInput({ className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return <input {...rest} type="file" className={classes(styles.box, styles.file, className)} />;
}

/** A value along a scale, as how much of a photograph to show. */
export function RangeInput({ className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return <input {...rest} type="range" className={classes(styles.range, className)} />;
}
