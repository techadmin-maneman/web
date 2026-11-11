// The hair profile's fields (./Profile.tsx): a field's choices as one group named by its title, a figure typed with
// the range it must be in.

import { sayKnown } from "../lang/index.ts";
import { Field, TextInput } from "@maneman/ui/Field";
import { ToggleButton } from "@maneman/ui/ToggleButton";
import { capsLook } from "@maneman/ui/Caps";
import { useId, type KeyboardEvent } from "react";
import shared from "./steps.module.css";
import styles from "./profile-fields.module.css";

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
 * A field's choices under its title, one tap each. One of them, as a radio group, where a tap on the one chosen keeps
 * it, so a stray tap never clears what the last profile said; or `many`, as buttons each pressed or not. Either way the group is named by its title, so a screen reader says which "Straight".
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
    <section className={shared.field} aria-labelledby={titleId}>
      <h2 className={capsLook(shared.fieldTitle)} id={titleId}>
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
              asRadio={!many}
              className={styles.chip}
              pressed={on}
              onClick={() => {
                onChoose(option.id);
              }}
            >
              {sayKnown(option.label)}
            </ToggleButton>
          );
        })}
      </div>
    </section>
  );
}

/** One figure, typed; the range it must be in is said beneath it only once it is outside it. */
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
  return (
    <Field
      className={styles.figure}
      label={label}
      error={invalid ? hint : null}
      look={{ label: shared.fieldLabel, error: shared.hint }}
    >
      {(control) => (
        <TextInput
          {...control}
          className={shared.box64}
          value={value}
          inputMode="decimal"
          autoComplete="off"
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      )}
    </Field>
  );
}
