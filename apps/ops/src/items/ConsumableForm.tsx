// Adding a consumable: its name, unit, cost, the levels each kind of place is low at, and its shelf life
// (docs/decisions/0087-consumables-and-stock.md, 0157-lots-and-expiry.md). Every box holds text, so an empty level is
// no level, never a nought. Once added, each changes where it reads in its record.

import { Field, TextInput } from "@maneman/ui/Field";
import { paiseFromRupees, rupees } from "@maneman/web-kit/money";
import { useState } from "react";
import { type Consumables } from "../api.ts";
import { AddForm } from "../components/AddForm.tsx";
import { figureOrNone } from "../components/RecordRows.tsx";
import form from "../components/forms.module.css";
import { settings } from "../content/settings.ts";
import { itemsApi } from "./items-api.ts";

const copy = settings.consumables;
const formWords = copy.form;

interface Draft {
  readonly name: string;
  readonly unit: string;
  readonly cost: string;
  readonly kit: string;
  readonly store: string;
  readonly central: string;
  readonly shelf: string;
}

const BLANK: Draft = { name: "", unit: "", cost: "", kit: "", store: "", central: "", shelf: "" };

/** A box of the form, by the field it fills and the name the API refuses it by. */
function ConsumableEntry(props: {
  readonly label: string;
  readonly box: string;
  readonly value: string;
  readonly maxLength: number;
  readonly width: "area" | "figure" | "amount";
  readonly numeric?: boolean;
  readonly onChange: (text: string) => void;
}) {
  return (
    <Field label={props.label} className={form.field} box={props.box}>
      {(control) => (
        <TextInput
          {...control}
          width={props.width}
          inputMode={props.numeric === true ? "decimal" : undefined}
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

const LEVELS = [
  ["kit", "reorder_kit"],
  ["store", "reorder_store"],
  ["central", "reorder_central"],
  ["shelf", "shelf_life_days"],
] as const;

export function AddConsumable(props: {
  readonly maxUnitCost: number;
  readonly onAdded: (consumables: Consumables) => void;
  readonly onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(BLANK);
  const edit = (field: keyof Draft) => (text: string) => {
    setDraft({ ...draft, [field]: text });
  };
  const figure = (text: string) => figureOrNone(text) ?? null;
  const unwhole = LEVELS.find(([field]) => figureOrNone(draft[field]) === undefined);
  return (
    <AddForm
      title={formWords.addTitle}
      words={formWords}
      errors={{ ...copy.errors, unit_cost: copy.unitCostUpTo(rupees(props.maxUnitCost)) }}
      boxes={["name", "unit", "unit_cost", ...LEVELS.map(([, box]) => box)]}
      send={() =>
        unwhole !== undefined
          ? Promise.resolve({ ok: false as const, code: "invalid_request", fields: [unwhole[1]] })
          : itemsApi.addConsumable({
              name: draft.name.trim(),
              unit: draft.unit.trim(),
              unit_cost: paiseFromRupees(draft.cost),
              reorder_kit: figure(draft.kit),
              reorder_store: figure(draft.store),
              reorder_central: figure(draft.central),
              shelf_life_days: figure(draft.shelf),
            })
      }
      onAdded={props.onAdded}
      onCancel={props.onCancel}
    >
      <div className={form.fields}>
        <ConsumableEntry label={formWords.name} box="name" width="area" maxLength={60} value={draft.name} onChange={edit("name")} />
        <ConsumableEntry
          label={formWords.unit}
          box="unit"
          width="figure"
          maxLength={20}
          value={draft.unit}
          onChange={edit("unit")}
        />
        <ConsumableEntry
          label={formWords.cost}
          box="unit_cost"
          width="amount"
          numeric
          maxLength={10}
          value={draft.cost}
          onChange={edit("cost")}
        />
      </div>
      <div className={form.fields}>
        {LEVELS.map(([field, box]) => (
          <ConsumableEntry
            key={field}
            label={formWords[field]}
            box={box}
            width="figure"
            numeric
            maxLength={6}
            value={draft[field]}
            onChange={edit(field)}
          />
        ))}
      </div>
    </AddForm>
  );
}
