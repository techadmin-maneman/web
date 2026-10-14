// The GST registrations by state: a state with one here has its visits supplied from it, and invoiced under its Books
// branch; any other is supplied from the registration Books is set up with (docs/decisions/0198-cities-as-data.md).

import { Panel } from "@maneman/ui/Panel";
import { Table } from "@maneman/ui/Table";
import { Field, TextInput } from "@maneman/ui/Field";
import { InlineMessage } from "@maneman/ui/InlineMessage";
import { useState } from "react";
import { client } from "../api.ts";
import { cities } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { ActionCheck, SettingForm, sentOf, useSteps } from "../settings/index.ts";
import styles from "../components/forms.module.css";
import type { CitiesBook } from "./book.ts";

const copy = cities.registrations;

interface Draft {
  readonly stateCode: string;
  readonly gstin: string;
  readonly branch: string;
}

const EMPTY: Draft = { stateCode: "", gstin: "", branch: "" };

function Entry(props: { label: string; value: string; max: number; onChange: (text: string) => void }) {
  return (
    <Field label={props.label} className={styles.field}>
      {(control) => (
        <TextInput
          {...control}
          className={styles.areaBox}
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
    async () => sentOf(await client.post("/api/gst-registrations", { body }), () => ({})),
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
      checking={<p className={styles.checkLine}>{copy.adding(body.state_code, body.gstin)}</p>}
    >
      <div className={styles.fields}>
        <Entry
          label={copy.stateCode}
          value={draft.stateCode}
          max={2}
          onChange={(stateCode) => {
            edit({ stateCode });
          }}
        />
        <Entry
          label={copy.gstin}
          value={draft.gstin}
          max={15}
          onChange={(gstin) => {
            edit({ gstin });
          }}
        />
        <Entry
          label={copy.branch}
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

export function Registrations({ book, onSaved }: { book: CitiesBook; onSaved: () => void }) {
  const access = useAccess();
  const [said, setSaid] = useState<string | null>(null);
  const saved = (words: string) => () => {
    setSaid(words);
    onSaved();
  };
  return (
    <Panel titleId="gst-registrations" title={copy.panel} count={book.registrations.length}>
      <p className={styles.note}>{copy.note}</p>
      {book.registrations.length === 0 ? (
        <p className={styles.note}>{copy.none}</p>
      ) : (
        <Table className={styles.table}>
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
            {book.registrations.map((registration) => (
              <tr key={registration.state_code}>
                <th scope="row" className={styles.rowHead}>
                  {registration.state_code}
                </th>
                <td>{registration.gstin}</td>
                <td>{registration.books_branch_id ?? copy.noBranch}</td>
                <td>
                  {access.mayCall("DELETE /api/gst-registrations/{state_code}") && (
                    <ActionCheck
                      label={copy.remove}
                      ariaLabel={copy.removeLabel(registration.state_code)}
                      question={copy.removeQuestion(registration.state_code)}
                      send={async () =>
                        sentOf(
                          await client.delete("/api/gst-registrations/{state_code}", {
                            path: { state_code: registration.state_code },
                          }),
                          () => ({}),
                        )
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
        <InlineMessage tone="saved" className={styles.saved}>
          {said}
        </InlineMessage>
      )}
      {access.mayCall("POST /api/gst-registrations") && <RegistrationForm onSaved={saved(copy.added)} />}
    </Panel>
  );
}
