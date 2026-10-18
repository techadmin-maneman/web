// A city added (docs/decisions/0198-cities-as-data.md): its name, its state for GST, its zone, and whether we serve it
// and offer it. Once added, each changes where it reads in its record.

import { Checkbox, Field, Select, TextInput } from "@maneman/ui/Field";
import { useState } from "react";
import { AddForm } from "../components/AddForm.tsx";
import form from "../components/forms.module.css";
import { cities } from "../content/cities.ts";
import { citiesApi } from "./cities-api.ts";

const formWords = cities.form;

interface Draft {
  readonly name: string;
  readonly stateCode: string;
  readonly state: string;
  readonly zone: string;
  readonly served: boolean;
  readonly active: boolean;
}

const BLANK: Draft = { name: "", stateCode: "", state: "", zone: "", served: false, active: true };

/** The words a city is named and placed by, each its own box. */
const TEXTS = [
  ["name", "name", 60],
  ["stateCode", "state_code", 2],
  ["state", "state", 60],
] as const;

/** The city's boxes: its name and state, its zone, and whether we serve it and offer it. */
function CityBoxes(props: { draft: Draft; zones: readonly string[]; edit: (change: Partial<Draft>) => void }) {
  const { draft, edit } = props;
  return (
    <>
      <div className={form.fields}>
        {TEXTS.map(([field, box, most]) => (
          <Field
            key={field}
            label={formWords[field]}
            hint={field === "stateCode" ? formWords.stateCodeHint : undefined}
            className={form.field}
            box={box}
          >
            {(control) => (
              <TextInput
                {...control}
                width="area"
                maxLength={most}
                value={draft[field]}
                onChange={(event) => {
                  edit({ [field]: event.target.value });
                }}
              />
            )}
          </Field>
        ))}
        <Field label={formWords.zone} className={form.field} box="zone">
          {(control) => (
            <Select
              {...control}
              value={draft.zone}
              onChange={(event) => {
                edit({ zone: event.target.value });
              }}
            >
              <option value="">{formWords.noZone}</option>
              {props.zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <div className={form.fields}>
        <Checkbox
          label={formWords.served}
          checked={draft.served}
          onChange={(event) => {
            edit({ served: event.target.checked });
          }}
        />
        <Checkbox
          label={formWords.active}
          checked={draft.active}
          onChange={(event) => {
            edit({ active: event.target.checked });
          }}
        />
      </div>
    </>
  );
}

export function AddCity(props: {
  readonly zones: readonly string[];
  readonly onAdded: () => Promise<void>;
  readonly onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(BLANK);
  return (
    <AddForm
      title={formWords.addTitle}
      words={formWords}
      errors={formWords.errors}
      boxes={["name", "state_code", "state", "zone"]}
      send={() =>
        citiesApi.addCity({
          name: draft.name.trim(),
          state_code: draft.stateCode.trim().toUpperCase(),
          state: draft.state.trim(),
          zone: draft.zone === "" ? null : draft.zone,
          served: draft.served,
          active: draft.active,
        })
      }
      onAdded={props.onAdded}
      onCancel={props.onCancel}
    >
      <CityBoxes
        draft={draft}
        zones={props.zones}
        edit={(change) => {
          setDraft({ ...draft, ...change });
        }}
      />
    </AddForm>
  );
}
