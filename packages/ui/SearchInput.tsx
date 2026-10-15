// A search box: a magnifier at its start, its label read and not shown, its words the label's own until typed in.

import { GLYPHS } from "@maneman/brand/icons";
import type { Ref } from "react";
import { Field, TextInput } from "./Field.tsx";
import { Icon } from "./Icon.tsx";
import { classes } from "./classes.ts";
import styles from "./search-input.module.css";

export function SearchInput({
  label,
  value,
  onChange,
  placeholder,
  maxLength,
  className,
  ref,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Shown in the empty box; the label without one. */
  readonly placeholder?: string;
  readonly maxLength?: number;
  readonly className?: string | undefined;
  readonly ref?: Ref<HTMLInputElement>;
}) {
  return (
    <Field label={label} labelHidden className={classes(styles.search, className)}>
      {(control) => (
        <div className={styles.box}>
          <Icon className={styles.icon} d={GLYPHS.search} size="xs" />
          <TextInput
            {...control}
            ref={ref}
            type="search"
            className={styles.input}
            value={value}
            placeholder={placeholder ?? label}
            maxLength={maxLength}
            onChange={(event) => {
              onChange(event.currentTarget.value);
            }}
          />
        </div>
      )}
    </Field>
  );
}
