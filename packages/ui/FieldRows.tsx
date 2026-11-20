// A form's commonest rows: a labelled choice of a few, and a labelled box of words, each a Field with its control in
// it, so a form names what it asks and what it says when refused, and draws none of its own.

import type { ReactNode } from "react";
import { ChoiceOptions, Field, Select, TextInput, type Choice } from "./Field.tsx";

type Width = Parameters<typeof TextInput>[0]["width"];

interface RowProps {
  readonly label: ReactNode;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly hint?: ReactNode;
  /** What is wrong with the value, once it is; null or absent while nothing is. */
  readonly error?: ReactNode;
  readonly className?: string;
  readonly width?: Width;
}

/** One of a few, labelled: each choice by its value and its name. */
export function SelectField(props: RowProps & { readonly choices: readonly Choice[] }) {
  return (
    <Field label={props.label} className={props.className} hint={props.hint} error={props.error ?? null}>
      {(control) => (
        <Select
          {...control}
          width={props.width ?? "choice"}
          value={props.value}
          onChange={(event) => {
            props.onChange(event.target.value);
          }}
        >
          <ChoiceOptions choices={props.choices} />
        </Select>
      )}
    </Field>
  );
}

/** Words to type, labelled, no longer than `maxLength`. */
export function TextField(props: RowProps & { readonly maxLength: number }) {
  return (
    <Field label={props.label} className={props.className} hint={props.hint} error={props.error ?? null}>
      {(control) => (
        <TextInput
          {...control}
          width={props.width}
          maxLength={props.maxLength}
          value={props.value}
          onChange={(event) => {
            props.onChange(event.target.value);
          }}
        />
      )}
    </Field>
  );
}
