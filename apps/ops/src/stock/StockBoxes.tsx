// The boxes of a stock movement (./StockForm.tsx): an item or a place chosen by name, how many, and its note, each
// saying the words of a refusal from the API that names it.

import { Field, NumberInput, Select, TextInput } from "@maneman/ui/Field";
import { stock as copy } from "../content/stock.ts";
import form from "../components/forms.module.css";

/** Words for a box the API refused, by the name it refused it by. */
export type Refused = (box: string) => string | null;

/** The boxes a movement of this kind draws, by the names the API refuses them by; the rest are the form's to say. */
export function stockBoxes(kind: string, scanned: boolean, lots: boolean): string[] {
  return [
    "consumable_code",
    ...(kind === "transfer" ? ["from", "to"] : ["note"]),
    ...(kind === "count" || kind === "write_off" ? ["place_id"] : []),
    ...(kind === "count" ? ["counted"] : []),
    ...(kind !== "count" && !scanned ? ["quantity"] : []),
    ...(kind === "delivery" || kind === "count" ? ["lot_code", "expires_on"] : []),
    ...(kind === "write_off" && lots ? ["lot_id"] : []),
  ];
}

/** One of the consumables or the places, by name. */
export function StockChoice(props: {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
  error: string | null;
}) {
  return (
    <Field label={props.label} className={form.field} error={props.error}>
      {(control) => (
        <Select
          {...control}
          width="choice"
          value={props.value}
          onChange={(event) => {
            props.onChange(event.target.value);
          }}
        >
          {props.options.map(([value, name]) => (
            <option key={value} value={value}>
              {name}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

/** How many, kept as typed until it is sent. */
export function Quantity(props: {
  label: string;
  hint?: string;
  value: string;
  onChange: (text: string) => void;
  error: string | null;
}) {
  return (
    <Field label={props.label} hint={props.hint} className={form.field} error={props.error}>
      {(control) => (
        <NumberInput
          {...control}
          width="figure"
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={props.value}
          onChange={(event) => {
            props.onChange(event.target.value);
          }}
        />
      )}
    </Field>
  );
}

/** What the movement was, or what was lost: optional for a delivery or a count, asked for a loss. */
export function NoteBox(props: { lost: boolean; note: string; onNote: (note: string) => void; error: string | null }) {
  return (
    <Field label={props.lost ? copy.record.lossNote : copy.record.note} className={form.field} error={props.error}>
      {(control) => (
        <TextInput
          {...control}
          width="area"
          maxLength={200}
          value={props.note}
          onChange={(event) => {
            props.onNote(event.target.value);
          }}
        />
      )}
    </Field>
  );
}
