// The GST registrations by state: a state with one here has its visits supplied from it, and invoiced under its Books
// branch; any other is supplied from the registration Books is set up with (docs/decisions/0198-cities-as-data.md).

import { CheckLine } from "../components/CheckPanel.tsx";
import { Panel } from "@maneman/ui/Panel";
import { Table } from "@maneman/ui/Table";
import { Field, TextInput } from "@maneman/ui/Field";
import { InlineMessage } from "@maneman/ui/InlineMessage";
import { useState } from "react";
import { cities } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { ActionCheck, SettingForm, sentOf, useSteps } from "../settings/index.ts";
import form from "../components/forms.module.css";
import type { Cities } from "./types.ts";
import { RowHead } from "../components/RowHead.tsx";
import { citiesApi } from "./cities-api.ts";

const copy = cities.registrations;

interface Draft {
  readonly stateCode: string;
  readonly gstin: string;
  readonly branch: string;
}

const EMPTY: Draft = { stateCode: "", gstin: "", branch: "" };

function RegistrationEntry(props: {
  label: string;
  value: string;
  max: number;
  onChange: (text: string) => void;
  box: string;
}) {
  return (
    <Field label={props.label} className={form.field} box={props.box}>
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

function RegistrationForm({ onSaved }: { onSaved: () => void }) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const body = {
    state_code: draft.stateCode.trim().toUpperCase(),
    gstin: draft.gstin.trim().toUpperCase(),
    books_branch_id: draft.branch.trim() === "" ? null : draft.branch.trim(),
  };
  const steps = useSteps(
    async () => sentOf(await citiesApi.addGstRegistration(body), () => ({})),
    () => {
      setDraft(EMPTY);
      onSaved();
    },
  );
  const edit = (change: Partial<Draft>) => {
    setDraft({ ...draft, ...change });
    steps.edit();
  };
  return (
    <SettingForm
      title={copy.add}
      steps={steps}
      ready={/^[A-Za-z]{2}$/.test(body.state_code) && body.gstin.length === 15}
      errors={copy.errors}
      onCancel={null}
      boxes={["state_code", "gstin", "books_branch_id"]}
      checking={<CheckLine>{copy.adding(body.state_code, body.gstin)}</CheckLine>}
    >
      <div className={form.fields}>
        <RegistrationEntry
          label={copy.stateCode}
          box="state_code"
          value={draft.stateCode}
          max={2}
          onChange={(stateCode) => {
            edit({ stateCode });
          }}
        />
        <RegistrationEntry
          label={copy.gstin}
          box="gstin"
          value={draft.gstin}
          max={15}
          onChange={(gstin) => {
            edit({ gstin });
          }}
        />
        <RegistrationEntry
          label={copy.branch}
          box="books_branch_id"
          value={draft.branch}
          max={40}
          onChange={(branch) => {
            edit({ branch });
          }}
        />
      </div>
    </SettingForm>
  );
}

export function Registrations({ cities, onSaved }: { cities: Cities; onSaved: () => void }) {
  const access = useAccess();
  const [said, setSaid] = useState<string | null>(null);
  const saved = (words: string) => () => {
    setSaid(words);
    onSaved();
  };
  return (
    <Panel titleId="gst-registrations" title={copy.panel} count={cities.registrations.length}>
      <p className={form.note}>{copy.note}</p>
      {cities.registrations.length === 0 ? (
        <p className={form.note}>{copy.none}</p>
      ) : (
        <Table className={form.table}>
          <thead>
            <tr>
              {copy.columns.map((column) => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cities.registrations.map((registration) => (
              <tr key={registration.state_code}>
                <RowHead>{registration.state_code}</RowHead>
                <td>{registration.gstin}</td>
                <td>{registration.books_branch_id ?? copy.noBranch}</td>
                <td>
                  {access.mayCall("DELETE /api/gst-registrations/{state_code}") && (
                    <ActionCheck
                      label={copy.remove}
                      ariaLabel={copy.removeLabel(registration.state_code)}
                      question={copy.removeQuestion(registration.state_code)}
                      send={async () =>
                        sentOf(await citiesApi.removeGstRegistration(registration.state_code), () => ({}))
                      }
                      onDone={saved(copy.removed)}
                      errors={copy.errors}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {said !== null && (
        <InlineMessage tone="saved" className={form.saved}>
          {said}
        </InlineMessage>
      )}
      {access.mayCall("POST /api/gst-registrations") && <RegistrationForm onSaved={saved(copy.added)} />}
    </Panel>
  );
}
