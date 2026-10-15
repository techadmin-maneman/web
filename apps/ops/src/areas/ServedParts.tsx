// Settings › Areas' parts (./Served.tsx): the city tabs with their bulk pair, one pincode's row, who a save would
// message, what sits beneath Save, and a file read with its changes shown before they go into the table.

import { InlineMessage } from "@maneman/ui/InlineMessage";
import { Badge } from "@maneman/ui/Badge";
import { Field, Checkbox, DateInput, Fieldset, FileInput, TextInput } from "@maneman/ui/Field";
import { errorText } from "@maneman/web-kit/refusal";
import { Button, RowButton } from "@maneman/ui/Button";
import { shortDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { Note } from "@maneman/ui/Note";
import { Table } from "@maneman/ui/Table";
import { TabButton, Tabs } from "@maneman/ui/Tabs";
import type { AreaChange, ServedPincode } from "../api.ts";
import { areas } from "../content.ts";
import form from "../components/forms.module.css";
import styles from "./served-parts.module.css";
import { LaunchPanel } from "./LaunchPanel.tsx";
import type { Draft, FileChange, Row } from "./served-draft.ts";
import { Refusal } from "../components/Refusal.tsx";
import { FormActions } from "../components/FormActions.tsx";
import { RowHead } from "../components/RowHead.tsx";
import { FormDrawer } from "../components/FormDrawer.tsx";

const copy = areas.served;
const launch = areas.launch;

export type Saving =
  | { readonly step: "editing" | "checking" | "saving" }
  | { readonly step: "saved"; readonly changed: number; readonly alerted: number }
  | { readonly step: "failed"; readonly code: string };

/** A file read, before its changes are put into the table. */
export type Upload =
  | { readonly step: "read"; readonly rows: readonly FileChange[] }
  | { readonly step: "applied" }
  | { readonly step: "failed"; readonly says: string };

interface PincodeRowProps {
  readonly pincode: ServedPincode;
  readonly row: Row;
  /** Whether the person's access lets them change it; if not, its boxes only show how it stands. */
  readonly mayChange: boolean;
  readonly onChange: (next: Row) => void;
}

/** One pincode's three settings, a box each, in a drawer beside the table; Done puts them into the page's change. */
function PincodeDrawer({
  id,
  row,
  onDone,
  onClose,
}: {
  id: string;
  row: Row;
  onDone: (next: Row) => void;
  onClose: () => void;
}) {
  const [next, setNext] = useState(row);
  return (
    <FormDrawer title={copy.editTitle(id, row.area)} onClose={onClose}>
      <div className={form.fields}>
        <Field label={copy.columns[1]}>
          {(control) => (
            <TextInput
              {...control}
              maxLength={40}
              value={next.area}
              onChange={(event) => {
                setNext({ ...next, area: event.target.value });
              }}
            />
          )}
        </Field>
        <Checkbox
          label={copy.columns[2]}
          checked={next.served}
          onChange={(event) => {
            setNext({ ...next, served: event.target.checked });
          }}
        />
        <Field label={copy.columns[3]}>
          {(control) => (
            <DateInput
              {...control}
              width="date"
              value={next.launch_on ?? ""}
              onChange={(event) => {
                setNext({ ...next, launch_on: event.target.value === "" ? null : event.target.value });
              }}
            />
          )}
        </Field>
      </div>
      <FormActions>
        <Button
          variant="primary"
          size="small"
          onClick={() => {
            onDone(next);
          }}
        >
          {copy.done}
        </Button>
        <Button variant="outline" size="small" narrow onClick={onClose}>
          {copy.cancel}
        </Button>
      </FormActions>
    </FormDrawer>
  );
}

export function PincodeRow({ pincode, row, mayChange, onChange }: PincodeRowProps) {
  const id = pincode.pincode;
  const [editing, setEditing] = useState(false);
  return (
    <tr>
      <RowHead>{id}</RowHead>
      <td>{row.area}</td>
      <td>{row.served ? <Badge tone="done">{copy.yes}</Badge> : copy.no}</td>
      <td>{row.launch_on === null ? "" : shortDate(row.launch_on)}</td>
      <td className={form.figure}>{pincode.waiting}</td>
      {mayChange && (
        <td className={styles.actions}>
          <RowButton
            aria-label={copy.editLabel(id)}
            onClick={() => {
              setEditing(true);
            }}
          >
            {copy.edit}
          </RowButton>
          {editing && (
            <PincodeDrawer
              id={id}
              row={row}
              onDone={(next) => {
                onChange(next);
                setEditing(false);
              }}
              onClose={() => {
                setEditing(false);
              }}
            />
          )}
        </td>
      )}
    </tr>
  );
}

/**
 * Who a save would message, before it is sent: serving a pincode launches it, in the panel Waiting uses. The message
 * names each area as it will be named once saved, so the preview leaves the name as a placeholder.
 */
export function LaunchCheck({
  launching,
  busy,
  onSend,
  onCancel,
}: {
  launching: readonly ServedPincode[];
  busy: boolean;
  onSend: () => void;
  onCancel: () => void;
}) {
  const people = launching.reduce((sum, each) => sum + each.to_alert, 0);
  const quiet = launching.reduce((sum, each) => sum + each.waiting - each.to_alert, 0);
  const only = launching.length === 1 ? launching[0] : undefined;
  return (
    <LaunchPanel
      label={only === undefined ? launch.manyLabel(launching.length) : launch.label(only.pincode)}
      alerts={people}
      area={null}
      lines={launching.map((each) => launch.line(each.pincode, each.area, each.to_alert))}
      sendLabel={launch.saveAndSend(people)}
      sending={busy}
      done={null}
      error={null}
      note={launch.note(quiet)}
      onSend={onSend}
      onCancel={onCancel}
    />
  );
}

/** A file's changes, pincode by pincode, before they go into the table. */
function FilePreview({
  rows,
  onApply,
  onCancel,
}: {
  rows: readonly FileChange[];
  onApply: () => void;
  onCancel: () => void;
}) {
  const describe = (row: Row) => copy.upload.state(row.served, row.launch_on);
  if (rows.length === 0) {
    return (
      <InlineMessage tone="saved" className={form.saved}>
        {copy.upload.none}
      </InlineMessage>
    );
  }
  return (
    <div className={styles.uploaded}>
      <InlineMessage tone="saved" className={form.saved}>
        {copy.upload.read(rows.length)}
      </InlineMessage>
      <Table controls>
        <thead>
          <tr>
            {copy.upload.columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.pincode.pincode}>
              <RowHead>{row.pincode.pincode}</RowHead>
              <td>{row.pincode.area}</td>
              <td>{describe(row.now)}</td>
              <td>{describe(row.file)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <FormActions>
        <Button variant="primary" size="small" onClick={onApply}>
          {copy.upload.apply}
        </Button>
        <Button variant="outline" size="small" narrow onClick={onCancel}>
          {copy.upload.cancel}
        </Button>
      </FormActions>
    </div>
  );
}

/** The whole file handed over: chosen, read, its changes shown, and put into the table or set aside. */
export function UploadFile({
  upload,
  onFile,
  onApply,
  onCancel,
}: {
  upload: Upload | null;
  onFile: (file: File) => void;
  onApply: (rows: readonly FileChange[]) => void;
  onCancel: () => void;
}) {
  return (
    <Fieldset className={form.group} legend={copy.upload.title} legendLook="title">
      <Field
        label={copy.upload.label}
        hint={copy.upload.hint}
        className={form.field}
        look={{ hint: styles.uploadHint }}
      >
        {(control) => (
          <FileInput
            {...control}
            className={form.file}
            accept=".csv,text/csv"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) onFile(file);
            }}
          />
        )}
      </Field>
      {upload?.step === "read" && (
        <FilePreview
          rows={upload.rows}
          onApply={() => {
            onApply(upload.rows);
          }}
          onCancel={onCancel}
        />
      )}
      {upload?.step === "applied" && (
        <InlineMessage tone="saved" className={form.saved}>
          {copy.upload.applied}
        </InlineMessage>
      )}
      {upload?.step === "failed" && <Refusal className={form.error} said={upload.says} />}
    </Fieldset>
  );
}

/** A city at a time: its tab says how many of its pincodes are served, and the bulk pair serves them all or none. */
export function CityTabs({
  pincodes,
  draft,
  city,
  mayChange,
  onCity,
  onBulk,
}: {
  pincodes: readonly ServedPincode[];
  draft: Draft;
  city: string;
  mayChange: boolean;
  onCity: (city: string) => void;
  onBulk: (served: boolean) => void;
}) {
  const cityTabs = [...new Set(pincodes.map((each) => each.city))];
  return (
    <>
      <Tabs className={styles.cities} label={copy.title}>
        {cityTabs.map((each) => {
          const all = pincodes.filter((one) => one.city === each);
          const served = all.filter((one) => draft[one.pincode]?.served === true).length;
          return (
            <TabButton
              key={each}
              current={each === city}
              onClick={() => {
                onCity(each);
              }}
            >
              {copy.city(each, served, all.length)}
            </TabButton>
          );
        })}
      </Tabs>

      {mayChange && (
        <FormActions>
          {[true, false].map((served) => (
            <Button
              variant="outline"
              size="small"
              key={String(served)}
              narrow
              onClick={() => {
                onBulk(served);
              }}
            >
              {served ? copy.bulk.serve(city) : copy.bulk.stop(city)}
            </Button>
          ))}
        </FormActions>
      )}
    </>
  );
}

/** Beneath Save: what keeps it dim, that nothing has changed yet, or how the save went. */
export function SaveNotes({
  saving,
  changes,
  badName,
  later,
  mayChange,
}: {
  saving: Saving;
  changes: readonly AreaChange[];
  badName: AreaChange | undefined;
  later: AreaChange | undefined;
  mayChange: boolean;
}) {
  return (
    <>
      {badName !== undefined && <Refusal className={form.error} said={copy.badName(badName.pincode)} />}
      {later !== undefined && <Refusal className={form.error} said={copy.later(later.pincode)} />}
      {mayChange && changes.length === 0 && saving.step === "editing" && <Note>{copy.nothing}</Note>}
      {saving.step === "saved" && (
        <InlineMessage tone="saved" className={form.saved}>
          {copy.saved(saving.changed, saving.alerted)}
        </InlineMessage>
      )}
      {saving.step === "failed" && (
        <Refusal className={form.error} said={errorText(copy.errors, { code: saving.code })} />
      )}
    </>
  );
}
