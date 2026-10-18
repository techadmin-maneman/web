// A record's values, each on a line of its own and changed where it reads (@maneman/ui/EditableRow;
// docs/decisions/0212-editing-in-place.md): a line of words, a figure, or one of a few choices. Each saves its own
// value; `save` answers null once kept, else the words of why not.

import { EditableRow } from "@maneman/ui/EditableRow";
import { NumberInput, Select, TextInput } from "@maneman/ui/Field";
import type { ReactNode } from "react";
import { EDITING } from "../content/common.ts";

interface RowProps {
  readonly label: string;
  readonly mayChange: boolean;
  readonly save: (typed: string) => Promise<string | null>;
  readonly id?: string | undefined;
}

/** A line of words: a name, a number, a note. `shown` is how it reads where it differs from what is typed. */
export function TextRow(
  props: RowProps & {
    readonly value: string;
    readonly shown?: ReactNode;
    readonly maxLength: number;
    readonly type?: "text" | "tel" | "email";
  },
) {
  return (
    <EditableRow<string>
      id={props.id}
      label={props.label}
      words={EDITING}
      mayChange={props.mayChange}
      value={props.shown ?? props.value}
      start={() => props.value}
      save={props.save}
    >
      {(control, typed, type) => (
        <TextInput
          {...control}
          type={props.type ?? "text"}
          width="area"
          autoComplete="off"
          maxLength={props.maxLength}
          value={typed}
          onChange={(event) => {
            type(event.target.value);
          }}
        />
      )}
    </EditableRow>
  );
}

/** A figure, with the unit it counts in after the box. */
export function FigureRow(
  props: RowProps & { readonly value: number | null; readonly shown: ReactNode; readonly unit?: string },
) {
  return (
    <EditableRow<string>
      id={props.id}
      label={props.label}
      words={EDITING}
      mayChange={props.mayChange}
      value={props.shown}
      unit={props.unit}
      start={() => (props.value === null ? "" : String(props.value))}
      save={props.save}
    >
      {(control, typed, type) => (
        <NumberInput
          {...control}
          type="text"
          width="figure"
          inputMode="decimal"
          value={typed}
          onChange={(event) => {
            type(event.target.value);
          }}
        />
      )}
    </EditableRow>
  );
}

/** One of a few choices, each by its value and the words it reads as. */
export function ChoiceRow(
  props: RowProps & { readonly value: string; readonly choices: readonly (readonly [string, string])[] },
) {
  const shown = props.choices.find(([value]) => value === props.value)?.[1] ?? props.value;
  return (
    <EditableRow<string>
      id={props.id}
      label={props.label}
      words={EDITING}
      mayChange={props.mayChange}
      value={shown}
      start={() => props.value}
      save={props.save}
    >
      {(control, chosen, choose) => (
        <Select
          {...control}
          width="choice"
          value={chosen}
          onChange={(event) => {
            choose(event.target.value);
          }}
        >
          {props.choices.map(([value, words]) => (
            <option key={value} value={value}>
              {words}
            </option>
          ))}
        </Select>
      )}
    </EditableRow>
  );
}
