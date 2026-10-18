// The GST registrations by state: a state with one here has its visits supplied from it, and invoiced under its Books
// branch; any other is supplied from the registration Books is set up with (docs/decisions/0198-cities-as-data.md).
// One is removed from its row, asked once.

import { Panel } from "@maneman/ui/Panel";
import { DrawerButton } from "../components/DrawerButton.tsx";
import { Table } from "@maneman/ui/Table";
import { Field, TextInput } from "@maneman/ui/Field";
import { InlineMessage } from "@maneman/ui/InlineMessage";
import { EmptyState } from "@maneman/ui/EmptyState";
import { errorText } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { AddForm } from "../components/AddForm.tsx";
import { DeleteAction } from "../components/DeleteAction.tsx";
import { cities } from "../content/cities.ts";
import { useAccess } from "../lib/access.ts";
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
          width="area"
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

function RegistrationForm({ onAdded, onCancel }: { onAdded: () => Promise<void>; onCancel: () => void }) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const edit = (change: Partial<Draft>) => {
    setDraft({ ...draft, ...change });
  };
  return (
    <AddForm
      title={copy.add}
      words={{ add: cities.form.add, cancel: copy.cancel }}
      errors={copy.errors}
      boxes={["state_code", "gstin", "books_branch_id"]}
      send={() =>
        citiesApi.addGstRegistration({
          state_code: draft.stateCode.trim().toUpperCase(),
          gstin: draft.gstin.trim().toUpperCase(),
          books_branch_id: draft.branch.trim() === "" ? null : draft.branch.trim(),
        })
      }
      onAdded={onAdded}
      onCancel={onCancel}
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
    </AddForm>
  );
}

export function Registrations({ cities, reread }: { cities: Cities; reread: () => Promise<void> }) {
  const access = useAccess();
  const [said, setSaid] = useState<string | null>(null);
  const saved = (words: string) => async () => {
    setSaid(words);
    await reread();
  };
  return (
    <Panel
      titleId="gst-registrations"
      title={copy.panel}
      count={cities.registrations.length}
      actions={
        access.mayCall("POST /api/gst-registrations") && (
          <DrawerButton label={copy.add}>
            {(close) => (
              <RegistrationForm
                onAdded={async () => {
                  close();
                  await saved(copy.added)();
                }}
                onCancel={close}
              />
            )}
          </DrawerButton>
        )
      }
    >
      {cities.registrations.length === 0 ? (
        <EmptyState look="panel" line={copy.none} />
      ) : (
        <Table>
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
                    <DeleteAction
                      name={registration.state_code}
                      words={copy.removing}
                      send={() => citiesApi.removeGstRegistration(registration.state_code)}
                      refusal={(code) => errorText(copy.errors, { code })}
                      onDeleted={saved(copy.removed)}
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
    </Panel>
  );
}
