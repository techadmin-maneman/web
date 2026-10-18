// A record's values, each on a line of its own and changed where it reads (@maneman/ui/EditableRow;
// docs/decisions/0212-editing-in-place.md): a line of words, a figure, an amount, or one of a few choices. Each saves
// its own value; `save` answers null once kept, else the words of why not.

import { EditableRow } from "@maneman/ui/EditableRow";
import { NumberInput, Select, TextArea, TextInput } from "@maneman/ui/Field";
import { rupees, rupeesTyped } from "@maneman/web-kit/money";
import type { ReactNode } from "react";
import { EDITING } from "../content/common.ts";
import rows from "./record-rows.module.css";

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

/** Words of a few lines, as an address prints: its line breaks kept as it reads. */
export function LinesRow(props: RowProps & { readonly value: string; readonly shown?: ReactNode; readonly maxLength: number; readonly lines: number }) {
  return (
    <EditableRow<string>
      id={props.id}
      label={props.label}
      words={EDITING}
      mayChange={props.mayChange}
      value={<span className={rows.lines}>{props.shown ?? props.value}</span>}
      start={() => props.value}
      save={props.save}
    >
      {(control, typed, type) => (
        <TextArea
          {...control}
          rows={props.lines}
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

/** A value that only reads: what follows from others, as whether one is still offered. */
export function ReadRow(props: { readonly label: string; readonly value: ReactNode }) {
  return (
    <EditableRow<null>
      label={props.label}
      words={EDITING}
      mayChange={false}
      value={props.value}
      start={() => null}
      save={() => Promise.resolve(null)}
    >
      {() => null}
    </EditableRow>
  );
}

/** An amount in rupees to the paisa, kept in paise. */
export function MoneyRow(props: RowProps & { readonly paise: number }) {
  return (
    <EditableRow<string>
      id={props.id}
      label={props.label}
      words={EDITING}
      mayChange={props.mayChange}
      value={rupees(props.paise)}
      start={() => rupeesTyped(props.paise)}
      save={props.save}
    >
      {(control, typed, type) => (
        <NumberInput
          {...control}
          type="text"
          width="amount"
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

/** A whole figure as typed, or null for an empty box; undefined for anything else, which the row refuses. */
export function figureOrNone(typed: string): number | null | undefined {
  const text = typed.trim();
  if (text === "") return null;
  return /^\d{1,6}$/.test(text) ? Number(text) : undefined;
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
