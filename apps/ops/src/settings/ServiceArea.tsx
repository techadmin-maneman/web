// Where we go, and from when (docs/decisions/0061-ops-editable-inputs.md).
//
// 198 pincodes is more than any web form should ask anybody to work through,
// and the owner already marks them in a spreadsheet (data/pincodes/README.md).
// So this screen is built for the two things they actually do: launch one
// area, which is one row and a date, and hand over the whole file, which is an
// upload. A city at a time keeps the table short; the bulk pair fills a city in
// one press; and only the pincodes that changed are ever sent.
//
// Everything goes through the table: a file read is shown pincode by pincode,
// then put into the table, and the one Save sends it. Serving a pincode is a
// launch, so a save that would message people waiting there says how many
// first (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).

import { Button } from "@maneman/ui/Button";
import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { useEffect, useRef, useState } from "react";
import { api, type AreaChange, type ServedPincode } from "../api.ts";
import { settings } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { readServiceAreaCsv, serviceAreaCsv, type CsvRead } from "./csv.ts";
import styles from "./settings.module.css";

const copy = settings.area;

/** An area's name as the API takes it: a letter or a digit first, 2 to 40 characters (src/routes/ops-settings.ts). */
const AREA_NAME = /^[\p{L}\p{N}][\p{L}\p{N} .,'()&-]{1,39}$/u;

/** What ops set for one pincode: the two columns that are theirs, and the area's name as they have typed it. */
interface Row {
  readonly served: boolean;
  readonly launch_on: string | null;
  readonly area: string;
}

type Draft = Readonly<Record<string, Row>>;

type Saving =
  | { readonly step: "editing" | "checking" | "saving" }
  | { readonly step: "saved"; readonly changed: number; readonly alerted: number }
  | { readonly step: "failed"; readonly code: string };

/** A file read, before its changes are put into the table. */
type Upload =
  | { readonly step: "read"; readonly rows: readonly FileChange[] }
  | { readonly step: "applied" }
  | { readonly step: "failed"; readonly says: string };

/** One pincode the file would change: what the table shows now, and what the file says. */
interface FileChange {
  readonly pincode: ServedPincode;
  readonly now: Row;
  readonly file: Row;
}

const rowOf = (pincode: ServedPincode): Row => ({
  served: pincode.served,
  launch_on: pincode.launch_on,
  area: pincode.area,
});

const draftOf = (pincodes: readonly ServedPincode[]): Draft =>
  Object.fromEntries(pincodes.map((each) => [each.pincode, rowOf(each)]));

const sameRow = (a: Row, b: Row) => a.served === b.served && a.launch_on === b.launch_on && a.area === b.area;

/** Only what has actually moved: the rest is not sent, so the audit log records no change that was not one. */
function changesIn(pincodes: readonly ServedPincode[], draft: Draft): AreaChange[] {
  const changes: AreaChange[] = [];
  for (const each of pincodes) {
    const row = draft[each.pincode];
    if (row === undefined) continue;
    const area = row.area.trim();
    if (sameRow({ ...row, area }, rowOf(each))) continue;
    changes.push({
      pincode: each.pincode,
      served: row.served,
      launch_on: row.launch_on,
      ...(area === each.area ? {} : { area }),
    });
  }
  return changes;
}

/** The pincodes a save would begin serving, where somebody waits to be told. */
function launchesIn(pincodes: readonly ServedPincode[], changes: readonly AreaChange[]): ServedPincode[] {
  return pincodes.filter((each) => {
    const change = changes.find((one) => one.pincode === each.pincode);
    return change !== undefined && change.served && !each.served && each.to_alert > 0;
  });
}

/** What a file read says, as the upload's line. */
function uploadRefusal(read: Extract<CsvRead, { ok: false }>): string {
  if (read.reason === "header") return copy.upload.badHeader;
  if (read.reason === "served") return copy.upload.badServed(read.pincode);
  return copy.upload.badDate(read.pincode);
}

interface PincodeRowProps {
  readonly pincode: ServedPincode;
  readonly row: Row;
  /** Whether the person's access lets them change it; if not, its boxes only show how it stands. */
  readonly mayChange: boolean;
  readonly onChange: (next: Row) => void;
}

function PincodeRow({ pincode, row, mayChange, onChange }: PincodeRowProps) {
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

/** Who a save would message, before it is sent: serving a pincode tells its waitlist, once. */
function LaunchCheck({
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
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
  }, []);
  const people = launching.reduce((sum, each) => sum + each.to_alert, 0);
  return (
    <div className={styles.check} ref={panel} tabIndex={-1} role="group" aria-labelledby="area-launch">
      <p className={styles.checkTitle} id="area-launch">
        {copy.launch.title(people)}
      </p>
      <ul className={styles.checkList}>
        {launching.map((each) => (
          <li key={each.pincode}>{copy.launch.line(each.pincode, each.area, each.to_alert)}</li>
        ))}
      </ul>
      <p className={styles.checkLine}>{copy.launch.note}</p>
      <div className={styles.actions}>
        <Button variant="primary" size="small" className={styles.save} disabled={busy} onClick={onSend}>
          {busy ? copy.saving : copy.launch.send(people)}
        </Button>
        <Button variant="outline" size="small" className={styles.quiet} disabled={busy} onClick={onCancel}>
          {copy.launch.cancel}
        </Button>
      </div>
    </div>
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

function Area({ pincodes: loadedPincodes }: { pincodes: readonly ServedPincode[] }) {
  const cities = [...new Set(loadedPincodes.map((each) => each.city))];
  const [pincodes, setPincodes] = useState(loadedPincodes);
  const [city, setCity] = useState(cities[0] ?? "");
  const [draft, setDraft] = useState<Draft>(() => draftOf(loadedPincodes));
  const [saving, setSaving] = useState<Saving>({ step: "editing" });
  const [upload, setUpload] = useState<Upload | null>(null);
  const mayChange = useAccess().mayCall("POST /api/service-area");

  const inCity = pincodes.filter((each) => each.city === city);
  const changes = changesIn(pincodes, draft);
  const badName = changes.find((change) => change.area !== undefined && !AREA_NAME.test(change.area));
  const launching = launchesIn(pincodes, changes);
  const busy = saving.step === "saving";

  const edit = (next: Draft) => {
    setDraft(next);
    setSaving({ step: "editing" });
  };

  const send = async () => {
    setSaving({ step: "saving" });
    const answer = await api.setServiceArea(changes);
    if (!answer.ok) {
      setSaving({ step: "failed", code: answer.code });
      return;
    }
    // The change is made, so what was a draft is now what we hold, and whoever waited there has been told.
    setPincodes((held) =>
      held.map((each) => {
        const change = changes.find((one) => one.pincode === each.pincode);
        if (change === undefined) return each;
        const launched = change.served && !each.served;
        return {
          ...each,
          served: change.served,
          launch_on: change.launch_on,
          area: change.area ?? each.area,
          to_alert: launched ? 0 : each.to_alert,
        };
      }),
    );
    setSaving({ step: "saved", changed: answer.body.changed, alerted: answer.body.alerted });
  };

  const readFile = async (file: File) => {
    const read = readServiceAreaCsv(await file.text());
    if (!read.ok) {
      setUpload({ step: "failed", says: uploadRefusal(read) });
      return;
    }
    const held = new Map(pincodes.map((each) => [each.pincode, each]));
    const rows: FileChange[] = [];
    for (const line of read.rows) {
      const pincode = held.get(line.pincode);
      const now = draft[line.pincode];
      if (pincode === undefined || now === undefined) continue;
      const file = { ...now, served: line.served, launch_on: line.launch_on };
      if (!sameRow(file, now)) rows.push({ pincode, now, file });
    }
    setUpload({ step: "read", rows });
  };

  /** The file's changes go into the draft, where the table shows them and the one Save sends them. */
  const applyFile = (rows: readonly FileChange[]) => {
    const next: Record<string, Row> = { ...draft };
    for (const row of rows) next[row.pincode.pincode] = row.file;
    edit(next);
    setUpload({ step: "applied" });
  };

  const download = () => {
    const blob = new Blob([serviceAreaCsv(pincodes)], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = copy.downloadName;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const pressSave = () => {
    if (launching.length > 0) setSaving({ step: "checking" });
    else void send();
  };

  const checking = saving.step === "checking" || (saving.step === "saving" && launching.length > 0);

  return (
    <section className={styles.panel} aria-labelledby="area">
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle} id="area">
          {copy.title}
        </h2>
        <Button variant="outline" size="small" className={styles.quiet} onClick={download}>
          {copy.download}
        </Button>
      </div>
      <p className={styles.note}>{copy.note}</p>

      <nav className={styles.cities} aria-label={copy.title}>
        {cities.map((each) => {
          const all = pincodes.filter((one) => one.city === each);
          const served = all.filter((one) => draft[one.pincode]?.served === true).length;
          return (
            <button
              key={each}
              className={styles.city}
              type="button"
              aria-current={each === city ? "true" : undefined}
              onClick={() => {
                setCity(each);
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
                const next: Record<string, Row> = { ...draft };
                for (const each of inCity) next[each.pincode] = { ...(next[each.pincode] ?? rowOf(each)), served };
                edit(next);
              }}
            >
              {served ? copy.bulk.serve(city) : copy.bulk.stop(city)}
            </Button>
          ))}
        </div>
      )}

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
          {inCity.map((each) => (
            <PincodeRow
              key={each.pincode}
              pincode={each}
              row={draft[each.pincode] ?? rowOf(each)}
              mayChange={mayChange}
              onChange={(next) => {
                edit({ ...draft, [each.pincode]: next });
              }}
            />
          ))}
        </tbody>
      </Table>
      <p className={styles.hint}>{copy.hint}</p>

      {checking && (
        <LaunchCheck
          launching={launching}
          busy={busy}
          onSend={() => void send()}
          onCancel={() => {
            setSaving({ step: "editing" });
          }}
        />
      )}
      {!checking && mayChange && (
        <div className={styles.actions}>
          <Button
            variant="primary"
            size="small"
            className={styles.save}
            disabled={busy || changes.length === 0 || badName !== undefined}
            onClick={pressSave}
          >
            {busy ? copy.saving : copy.save}
          </Button>
        </div>
      )}
      {badName !== undefined && (
        <p className={styles.error} role="alert">
          {copy.badName(badName.pincode)}
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
          {copy.errors[saving.code] ?? copy.errors.unknown}
        </p>
      )}

      {mayChange && (
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
                if (file !== undefined) void readFile(file);
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
                applyFile(upload.rows);
              }}
              onCancel={() => {
                setUpload(null);
              }}
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
      )}
    </section>
  );
}

export function ServiceArea() {
  const [loaded, retry] = useLoad(api.serviceArea);
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  return <Area pincodes={loaded.value.pincodes} />;
}
