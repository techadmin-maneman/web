// The hair profile's fields (./Profile.tsx): a field's choices as one group named by its title, a figure typed with
// the range it must be in, and the base in centimetres beside its inches.

import { Label, TextInput } from "@maneman/ui/Field";
import { ToggleButton } from "@maneman/ui/ToggleButton";
import { capsLook } from "@maneman/ui/Caps";
import type { Typed } from "@maneman/web-kit/hair-profile";
import { useId, type KeyboardEvent } from "react";
import { profile as copy } from "../content.ts";
import styles from "./steps.module.css";

export interface Option<T> {
  readonly id: T;
  readonly label: string;
}

const ARROWS: Readonly<Record<string, number>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/** The arrow keys move along a field's choices, as they do along any group of radio buttons. */
function moveAlong(event: KeyboardEvent<HTMLDivElement>): void {
  const step = ARROWS[event.key];
  if (step === undefined) return;
  const chips = [...event.currentTarget.querySelectorAll("button")];
  const at = chips.findIndex((chip) => chip === document.activeElement);
  chips[(at + step + chips.length) % chips.length]?.focus();
  event.preventDefault();
}

/**
 * A field's choices under its title, one tap each. One of them, as a radio group a second tap clears; or `many`, as
 * buttons each pressed or not. Either way the group is named by its title, so a screen reader says which "Straight".
 */
export function Chips<T extends string | number>({
  title,
  options,
  isChosen,
  onChoose,
  many = false,
}: {
  title: string;
  options: readonly Option<T>[];
  isChosen: (id: T) => boolean;
  onChoose: (id: T) => void;
  many?: boolean;
}) {
  const titleId = useId();
  return (
    <section className={styles.field} aria-labelledby={titleId}>
      <h2 className={capsLook(styles.fieldTitle)} id={titleId}>
        {title}
      </h2>
      <div
        className={styles.chips}
        role={many ? "group" : "radiogroup"}
        aria-labelledby={titleId}
        onKeyDown={many ? undefined : moveAlong}
      >
        {options.map((option) => {
          const on = isChosen(option.id);
          return (
            <ToggleButton
              key={option.id}
              onInk
              asRadio={!many}
              className={styles.chip}
              pressed={on}
              onClick={() => {
                onChoose(option.id);
              }}
            >
              {option.label}
            </ToggleButton>
          );
        })}
      </div>
    </section>
  );
}

const CM_PER_INCH = 2.54;

/** The base, once both its figures are typed, in centimetres too: the head beside it is measured in them. */
export function BaseInCentimetres({ width, length }: { width: Typed; length: Typed }) {
  if (typeof width !== "number" || typeof length !== "number") return null;
  const cm = (inches: number) => (inches * CM_PER_INCH).toFixed(1);
  return <p className={styles.inCentimetres}>{copy.baseInCentimetres(cm(width), cm(length))}</p>;
}

/** One figure, typed, with the range it must be in said beneath it while it is not. */
export function Figure({
  label,
  value,
  invalid,
  hint,
  onChange,
}: {
  label: string;
  value: string;
  invalid: boolean;
  hint: string;
  onChange: (text: string) => void;
}) {
  const id = useId();
  return (
    <div className={styles.figure}>
      <Label onInk className={styles.fieldLabel} htmlFor={id}>
        {label}
      </Label>
      <TextInput
        onInk
        className={styles.box64}
        id={id}
        value={value}
        inputMode="decimal"
        autoComplete="off"
        aria-invalid={invalid}
        aria-describedby={`${id}-hint`}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {/* The range always shows, so a figure outside it is never refused without saying why. */}
      <p className={invalid ? styles.hint : styles.range} id={`${id}-hint`}>
        {hint}
      </p>
    </div>
  );
}
