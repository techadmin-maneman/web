// Settings › Areas' parts (./Served.tsx): the city tabs, one pincode's row and its drawer, who a save would message,
// how the last save went, and a file read with its changes shown before they are saved.

import { Toast } from "@maneman/ui/Toast";
import { InlineMessage } from "@maneman/ui/InlineMessage";
import { Badge } from "@maneman/ui/Badge";
import { Field, Checkbox, DateInput, Fieldset, FileInput, TextInput } from "@maneman/ui/Field";
import { errorText } from "@maneman/web-kit/refusal";
import { Button, RowButton } from "@maneman/ui/Button";
import { shortDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { Table } from "@maneman/ui/Table";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { TabButton, Tabs } from "@maneman/ui/Tabs";
import type { ServedPincode } from "../api.ts";
import { areas } from "../content.ts";
import form from "../components/forms.module.css";
import styles from "./served-parts.module.css";
import { LaunchPanel } from "./LaunchPanel.tsx";
import { rowOf, type FileChange, type Row, type Upload } from "./served-draft.ts";
import type { CsvRow } from "./csv.ts";
import { AREA_NAME } from "./rules.ts";
import type { Saving } from "./useAreaSaves.ts";
import { Refusal } from "../components/Refusal.tsx";
import { FormActions } from "../components/FormActions.tsx";
import { RowHead } from "../components/RowHead.tsx";
import { FormDrawer } from "../components/FormDrawer.tsx";

const copy = areas.served;
const launch = areas.launch;

interface PincodeRowProps {
  readonly pincode: ServedPincode;
  /** Whether it is chosen for the bar's pair; null where the person's access lets them change nothing. */
  readonly chosen: boolean | null;
  readonly onChoose: (chosen: boolean) => void;
  /** Sends the row's settings, or answers why they cannot go. */
  readonly onSave: (next: Row) => string | null;
}

/** One pincode's three settings, a box each, in a drawer beside the table; Save sends them. */
function PincodeDrawer({
  id,
  row,
  onSave,
  onClose,
}: {
  id: string;
  row: Row;
  onSave: (next: Row) => string | null;
  onClose: () => void;
}) {
  const [next, setNext] = useState(row);
  const [refused, setRefused] = useState<string | null>(null);
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
      {refused !== null && <Refusal className={form.error} said={refused} />}
      <FormActions>
        <Button
          variant="primary"
          size="small"
          onClick={() => {
            setRefused(onSave(next));
          }}
        >
          {copy.save}
        </Button>
        <Button variant="outline" size="small" narrow onClick={onClose}>
          {copy.cancel}
        </Button>
      </FormActions>
    </FormDrawer>
  );
}

export function PincodeRow({ pincode, chosen, onChoose, onSave }: PincodeRowProps) {
  const id = pincode.pincode;
  const [editing, setEditing] = useState(false);
  return (
    <tr>
      {chosen !== null && (
        <td className={styles.choose}>
          <Checkbox
            aria-label={copy.chosen.one(id)}
            checked={chosen}
            onChange={(event) => {
              onChoose(event.target.checked);
            }}
          />
        </td>
      )}
      <RowHead>{id}</RowHead>
      <td>{pincode.area}</td>
      <td>
        {pincode.served && pincode.paused_until !== null && (
          <Badge tone="attention">{areas.pause.chip(shortDate(pincode.paused_until))}</Badge>
        )}
        {pincode.served && pincode.paused_until === null && <Badge tone="done">{copy.yes}</Badge>}
        {!pincode.served && copy.no}
      </td>
      <td>{pincode.launch_on === null ? "" : shortDate(pincode.launch_on)}</td>
      <td className={form.figure}>{pincode.waiting}</td>
      {chosen !== null && (
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
              row={rowOf(pincode)}
              onSave={(next) => {
                const refused = onSave(next);
                if (refused === null) setEditing(false);
                return refused;
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

/** The pincodes a file would add, not served yet, each in the city the file names: added before its changes are read. */
function FileAdds({
  adds,
  onAdd,
  onCancel,
}: {
  adds: readonly CsvRow[];
  onAdd: () => Promise<void>;
  onCancel: () => void;
}) {
  const [busy, once] = useOneAtATime();
  return (
    <div className={styles.uploaded}>
      <InlineMessage tone="saved" className={form.saved}>
        {copy.upload.adds(adds.length)}
      </InlineMessage>
      <Table controls>
        <thead>
          <tr>
            {copy.upload.addColumns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {adds.map((each) => (
            <tr key={each.pincode}>
              <RowHead>{each.pincode}</RowHead>
              <td>{AREA_NAME.test(each.area) ? each.area : copy.upload.suggested}</td>
              <td>{each.city}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <FormActions>
        <Button variant="primary" size="small" disabled={busy} onClick={() => void once(onAdd)}>
          {busy ? copy.upload.adding : copy.upload.add(adds.length)}
        </Button>
        <Button variant="outline" size="small" narrow onClick={onCancel}>
          {copy.upload.cancel}
        </Button>
      </FormActions>
    </div>
  );
}

/** The whole file handed over: chosen, read, its new pincodes added, its changes shown, and put into the table or set aside. */
export function UploadFile({
  upload,
  onFile,
  onAdd,
  onApply,
  onCancel,
}: {
  upload: Upload | null;
  onFile: (file: File) => void;
  onAdd: (lines: readonly CsvRow[], adds: readonly CsvRow[]) => Promise<void>;
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
      {upload?.step === "read" && upload.said !== null && <Toast>{upload.said}</Toast>}
      {upload?.step === "read" && upload.adds.length > 0 && (
        <FileAdds adds={upload.adds} onAdd={() => onAdd(upload.lines, upload.adds)} onCancel={onCancel} />
      )}
      {upload?.step === "read" && upload.adds.length === 0 && (
        <FilePreview
          rows={upload.rows}
          onApply={() => {
            onApply(upload.rows);
          }}
          onCancel={onCancel}
        />
      )}
      {upload?.step === "failed" && <Refusal className={form.error} said={upload.says} />}
    </Fieldset>
  );
}

/** A city at a time: its tab says how many of its pincodes are served. */
export function CityTabs({
  pincodes,
  city,
  onCity,
}: {
  pincodes: readonly ServedPincode[];
  city: string;
  onCity: (city: string) => void;
}) {
  const cityTabs = [...new Set(pincodes.map((each) => each.city))];
  return (
    <Tabs className={styles.cities} label={copy.title}>
      {cityTabs.map((each) => {
        const all = pincodes.filter((one) => one.city === each);
        const served = all.filter((one) => one.served).length;
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
  );
}

/** How the last save went. */
export function SaveNotes({ saving }: { saving: Saving }) {
  if (saving.step === "saved") return <Toast>{copy.saved(saving.changed, saving.alerted)}</Toast>;
  if (saving.step === "failed") {
    return <Refusal className={form.error} said={errorText(copy.errors, { code: saving.code })} />;
  }
  return null;
}
