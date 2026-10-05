// The Served tab's parts (./Served.tsx): the city tabs with their bulk pair, one pincode's row, who a save would
// message, what sits beneath Save, and a file read with its changes shown before they go into the table.

import { errorText } from "@maneman/web-kit/refusal";
import { Button } from "@maneman/ui/Button";
import { Table } from "@maneman/ui/Table";
import type { AreaChange, ServedPincode } from "../api.ts";
import { areas } from "../content.ts";
import styles from "../settings/settings.module.css";
import { LaunchPanel } from "./LaunchPanel.tsx";
import type { Draft, FileChange, Row } from "./served-draft.ts";

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

export function PincodeRow({ pincode, row, mayChange, onChange }: PincodeRowProps) {
  const id = pincode.pincode;
  return (
    <tr>
      <th scope="row" className={styles.rowHead}>
        {id}
      </th>
      <td>
        <input
          className={styles.cellText}
          id={`area-${id}`}
          type="text"
          maxLength={40}
          aria-label={copy.areaLabel(id)}
          disabled={!mayChange}
          value={row.area}
          onChange={(event) => {
            onChange({ ...row, area: event.target.value });
          }}
        />
      </td>
      <td>
        <input
          className={styles.box}
          type="checkbox"
          aria-label={copy.served(id)}
          disabled={!mayChange}
          checked={row.served}
          onChange={(event) => {
            onChange({ ...row, served: event.target.checked });
          }}
        />
      </td>
      <td>
        <input
          className={styles.cellDate}
          type="date"
          aria-label={copy.launchOn(id)}
          disabled={!mayChange}
          value={row.launch_on ?? ""}
          onChange={(event) => {
            onChange({ ...row, launch_on: event.target.value === "" ? null : event.target.value });
          }}
        />
      </td>
      <td className={styles.figure}>{pincode.waiting}</td>
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
      <p className={styles.saved} role="status">
        {copy.upload.none}
      </p>
    );
  }
  return (
    <div className={styles.uploaded}>
      <p className={styles.saved} role="status">
        {copy.upload.read(rows.length)}
      </p>
      <Table className={styles.table}>
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
              <th scope="row" className={styles.rowHead}>
                {row.pincode.pincode}
              </th>
              <td>{row.pincode.area}</td>
              <td>{describe(row.now)}</td>
              <td>{describe(row.file)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <div className={styles.actions}>
        <Button variant="primary" size="small" className={styles.save} onClick={onApply}>
          {copy.upload.apply}
        </Button>
        <Button variant="outline" size="small" className={styles.quiet} onClick={onCancel}>
          {copy.upload.cancel}
        </Button>
      </div>
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
    <fieldset className={styles.group}>
      <legend className={styles.ruleTitle}>{copy.upload.title}</legend>
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="area-file">
          {copy.upload.label}
        </label>
        <input
          className={styles.file}
          id="area-file"
          type="file"
          accept=".csv,text/csv"
          aria-describedby="area-file-hint"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) onFile(file);
          }}
        />
        <p className={styles.hint} id="area-file-hint">
          {copy.upload.hint}
        </p>
      </div>
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
        <p className={styles.saved} role="status">
          {copy.upload.applied}
        </p>
      )}
      {upload?.step === "failed" && (
        <p className={styles.error} role="alert">
          {upload.says}
        </p>
      )}
    </fieldset>
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
      <nav className={styles.cities} aria-label={copy.title}>
        {cityTabs.map((each) => {
          const all = pincodes.filter((one) => one.city === each);
          const served = all.filter((one) => draft[one.pincode]?.served === true).length;
          return (
            <button
              key={each}
              className={styles.city}
              type="button"
              aria-current={each === city ? "true" : undefined}
              onClick={() => {
                onCity(each);
              }}
            >
              {copy.city(each, served, all.length)}
            </button>
          );
        })}
      </nav>

      {mayChange && (
        <div className={styles.actions}>
          {[true, false].map((served) => (
            <Button
              variant="outline"
              size="small"
              key={String(served)}
              className={styles.quiet}
              onClick={() => {
                onBulk(served);
              }}
            >
              {served ? copy.bulk.serve(city) : copy.bulk.stop(city)}
            </Button>
          ))}
        </div>
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
      {badName !== undefined && (
        <p className={styles.error} role="alert">
          {copy.badName(badName.pincode)}
        </p>
      )}
      {later !== undefined && (
        <p className={styles.error} role="alert">
          {copy.later(later.pincode)}
        </p>
      )}
      {mayChange && changes.length === 0 && saving.step === "editing" && <p className={styles.hint}>{copy.nothing}</p>}
      {saving.step === "saved" && (
        <p className={styles.saved} role="status">
          {copy.saved(saving.changed, saving.alerted)}
        </p>
      )}
      {saving.step === "failed" && (
        <p className={styles.error} role="alert">
          {errorText(copy.errors, { code: saving.code })}
        </p>
      )}
    </>
  );
}
