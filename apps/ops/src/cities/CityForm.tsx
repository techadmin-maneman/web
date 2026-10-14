// A city added, or changed: its name, its state for GST, its zone, and whether we serve it and offer it. The check
// sets each change beside what it was, and a new name says what it moves (docs/decisions/0198-cities-as-data.md).

import { Checkbox, Field, Select, TextInput } from "@maneman/ui/Field";
import { useState } from "react";
import { client } from "../api.ts";
import { cities } from "../content.ts";
import { SettingForm, sentOf, useSteps } from "../settings/index.ts";
import form from "../components/forms.module.css";
import type { City } from "./types.ts";

const formWords = cities.form;

interface Draft {
  readonly name: string;
  readonly stateCode: string;
  readonly state: string;
  readonly zone: string;
  readonly served: boolean;
  readonly active: boolean;
}

const draftOf = (city: City | null): Draft => ({
  name: city?.name ?? "",
  stateCode: city?.state_code ?? "",
  state: city?.state ?? "",
  zone: city?.zone ?? "",
  served: city?.served ?? false,
  active: city?.active ?? true,
});

const bodyOf = (draft: Draft) => ({
  name: draft.name.trim(),
  state_code: draft.stateCode.trim().toUpperCase(),
  state: draft.state.trim(),
  zone: draft.zone === "" ? null : draft.zone,
  served: draft.served,
  active: draft.active,
});

const said = (value: string | boolean | null): string => {
  if (typeof value === "boolean") return value ? formWords.yes : formWords.no;
  return value ?? formWords.noZone;
};

/** Each field that changes, old beside new, and what a new name moves; empty where nothing changes. */
function changes(was: City, draft: Draft): string[] {
  const now = bodyOf(draft);
  const fields = [
    ["name", formWords.name],
    ["state_code", formWords.stateCode],
    ["state", formWords.state],
    ["zone", formWords.zone],
    ["served", formWords.served],
    ["active", formWords.active],
  ] as const;
  const lines = fields
    .filter(([field]) => was[field] !== now[field])
    .map(([field, label]) => formWords.line(label, said(was[field]), said(now[field])));
  return now.name === was.name ? lines : [...lines, formWords.renames(was.name, now.name)];
}

function Text(props: { label: string; value: string; max: number; hint?: string; onChange: (text: string) => void }) {
  return (
    <Field label={props.label} hint={props.hint} className={form.field}>
      {(control) => (
        <TextInput
          {...control}
          className={form.areaBox}
          maxLength={props.max}
          value={props.value}
          onChange={(event) => {
            props.onChange(event.target.value);
          }}
        />
      )}
    </Field>
  );
}

function CityBoxes(props: { draft: Draft; zones: readonly string[]; edit: (change: Partial<Draft>) => void }) {
  const { draft, edit } = props;
  return (
    <>
      <div className={form.fields}>
        <Text
          label={formWords.name}
          value={draft.name}
          max={60}
          onChange={(name) => {
            edit({ name });
          }}
        />
        <Text
          label={formWords.stateCode}
          hint={formWords.stateCodeHint}
          value={draft.stateCode}
          max={2}
          onChange={(stateCode) => {
            edit({ stateCode });
          }}
        />
        <Text
          label={formWords.state}
          value={draft.state}
          max={60}
          onChange={(state) => {
            edit({ state });
          }}
        />
        <Field label={formWords.zone} className={form.field}>
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

export function CityForm(props: {
  /** The one to change; null to add a city. */
  city: City | null;
  zones: readonly string[];
  onSaved: (said: string) => void;
  onCancel: (() => void) | null;
}) {
  const { city } = props;
  const [draft, setDraft] = useState<Draft>(() => draftOf(city));
  const ready = draft.name.trim() !== "" && /^[A-Za-z]{2}$/.test(draft.stateCode.trim()) && draft.state.trim() !== "";
  const steps = useSteps(
    async () => {
      const body = bodyOf(draft);
      const answer =
        city === null
          ? await client.post("/api/cities", { body })
          : await client.patch("/api/cities/{name}", { path: { name: city.name }, body });
      return sentOf(answer, () => ({}));
    },
    () => {
      props.onSaved(city === null ? formWords.added : formWords.saved);
    },
  );
  const edit = (change: Partial<Draft>) => {
    setDraft({ ...draft, ...change });
    steps.edit();
  };
  const body = bodyOf(draft);
  const lines = city === null ? [formWords.adding(body.name, body.state)] : changes(city, draft);
  return (
    <SettingForm
      title={city === null ? formWords.addTitle : formWords.changeTitle(city.name)}
      steps={steps}
      ready={ready}
      errors={formWords.errors}
      onCancel={props.onCancel}
      sendable={lines.length > 0}
      checking={(lines.length === 0 ? [formWords.nothing] : lines).map((line) => (
        <p className={form.checkLine} key={line}>
          {line}
        </p>
      ))}
    >
      <CityBoxes draft={draft} zones={props.zones} edit={edit} />
    </SettingForm>
  );
}
