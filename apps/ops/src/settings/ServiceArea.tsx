// Where we go, and from when (docs/decisions/0060-ops-editable-inputs.md).
//
// 198 pincodes is more than any web form should ask anybody to work through,
// and the owner already marks them in a spreadsheet (data/pincodes/README.md).
// So this screen is built for the two things they actually do: launch one
// area, which is one row and a date, and hand over the whole file, which is an
// upload. A city at a time keeps the table short; the bulk pair fills a city in
// one press; and only the pincodes that changed are ever sent.

import { useState } from "react";
import { api, type ServedPincode } from "../api.ts";
import { settings } from "../content.ts";
import { useLoad } from "../lib/useLoad.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { readServiceAreaCsv, serviceAreaCsv } from "./csv.ts";
import styles from "./settings.module.css";

const copy = settings.area;

/** The two columns ops own, against the pincode they belong to. */
type Draft = Readonly<Record<string, { served: boolean; launch_on: string | null }>>;

type Saving =
  | { readonly step: "editing" | "saving" }
  | { readonly step: "saved"; readonly changed: number }
  | { readonly step: "failed"; readonly code: string };

const draftOf = (pincodes: readonly ServedPincode[]): Draft =>
  Object.fromEntries(pincodes.map((each) => [each.pincode, { served: each.served, launch_on: each.launch_on }]));

/** Only what has actually moved: the rest is not sent, so the audit log records no change that was not one. */
function changesIn(pincodes: readonly ServedPincode[], draft: Draft) {
  return pincodes
    .filter((each) => {
      const now = draft[each.pincode];
      return now !== undefined && (now.served !== each.served || now.launch_on !== each.launch_on);
    })
    .map((each) => ({
      pincode: each.pincode,
      served: draft[each.pincode]?.served ?? each.served,
      launch_on: draft[each.pincode]?.launch_on ?? each.launch_on,
    }));
}

/** The file ops uploaded, read and held until they confirm it. */
type Upload =
  | { readonly step: "read"; readonly changes: ReturnType<typeof changesIn> }
  | { readonly step: "failed"; readonly says: string };

function Row({
  pincode,
  draft,
  onChange,
}: {
  pincode: ServedPincode;
  draft: { served: boolean; launch_on: string | null };
  onChange: (next: { served: boolean; launch_on: string | null }) => void;
}) {
  const served = `served-${pincode.pincode}`;
  const launch = `launch-${pincode.pincode}`;
  return (
    <tr>
      <th scope="row" className={styles.rowHead}>
        {pincode.pincode}
      </th>
      <td>{pincode.area}</td>
      <td>
        <span className={styles.check}>
          <input
            id={served}
            type="checkbox"
            checked={draft.served}
            onChange={(event) => {
              onChange({ ...draft, served: event.target.checked });
            }}
          />
          <label htmlFor={served}>
            {copy.served} {pincode.pincode}
          </label>
        </span>
      </td>
      <td>
        <label className={styles.rowLabel} htmlFor={launch}>
          {copy.launchOn} {pincode.pincode}
        </label>
        <input
          className={styles.text}
          id={launch}
          type="date"
          value={draft.launch_on ?? ""}
          onChange={(event) => {
            onChange({ ...draft, launch_on: event.target.value === "" ? null : event.target.value });
          }}
        />
      </td>
    </tr>
  );
}

function Area({ pincodes: loadedPincodes }: { pincodes: readonly ServedPincode[] }) {
  const cities = [...new Set(loadedPincodes.map((each) => each.city))];
  const [pincodes, setPincodes] = useState(loadedPincodes);
  const [city, setCity] = useState(cities[0] ?? "");
  const [draft, setDraft] = useState<Draft>(() => draftOf(loadedPincodes));
  const [saving, setSaving] = useState<Saving>({ step: "editing" });
  const [upload, setUpload] = useState<Upload | null>(null);

  const inCity = pincodes.filter((each) => each.city === city);
  const changes = changesIn(pincodes, draft);
  const busy = saving.step === "saving";

  const send = async (sending: ReturnType<typeof changesIn>) => {
    setSaving({ step: "saving" });
    const answer = await api.setServiceArea(sending);
    if (!answer.ok) {
      setSaving({ step: "failed", code: answer.code });
      return;
    }
    // The change is made, so what was a draft is now what we hold.
    setPincodes((held) =>
      held.map((each) => {
        const change = sending.find((one) => one.pincode === each.pincode);
        return change === undefined ? each : { ...each, served: change.served, launch_on: change.launch_on };
      }),
    );
    setUpload(null);
    setSaving({ step: "saved", changed: answer.body.changed });
  };

  const readFile = async (file: File) => {
    const read = readServiceAreaCsv(await file.text());
    if (!read.ok) {
      setUpload({
        step: "failed",
        says: read.reason === "header" ? copy.upload.badHeader : copy.upload.badDate(read.pincode),
      });
      return;
    }
    const held = new Map(pincodes.map((each) => [each.pincode, each]));
    const changed = read.rows
      .filter((row) => {
        const was = held.get(row.pincode);
        return was !== undefined && (was.served !== row.served || was.launch_on !== row.launch_on);
      })
      .map((row) => ({ pincode: row.pincode, served: row.served, launch_on: row.launch_on }));
    setUpload({ step: "read", changes: changed });
  };

  const download = () => {
    const blob = new Blob([serviceAreaCsv(pincodes)], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = copy.downloadName;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <section className={styles.panel} aria-labelledby="area">
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle} id="area">
          {copy.title}
        </h2>
        <button className={styles.quiet} type="button" onClick={download}>
          {copy.download}
        </button>
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

      <div className={styles.actions}>
        {[true, false].map((served) => (
          <button
            key={String(served)}
            className={styles.quiet}
            type="button"
            onClick={() => {
              setDraft((held) => {
                const next = { ...held };
                for (const each of inCity) next[each.pincode] = { ...(next[each.pincode] ?? each), served };
                return next;
              });
              setSaving({ step: "editing" });
            }}
          >
            {served ? copy.bulk.serve(city) : copy.bulk.stop(city)}
          </button>
        ))}
      </div>

      <table className={styles.table}>
        <thead>
          <tr>
            {copy.columns.map((column) => (
              <th key={column} scope="col" className={styles.column}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {inCity.map((each) => (
            <Row
              key={each.pincode}
              pincode={each}
              draft={draft[each.pincode] ?? { served: each.served, launch_on: each.launch_on }}
              onChange={(next) => {
                setDraft({ ...draft, [each.pincode]: next });
                setSaving({ step: "editing" });
              }}
            />
          ))}
        </tbody>
      </table>
      <p className={styles.hint}>{copy.launchHint}</p>

      <div className={styles.actions}>
        <button
          className={styles.save}
          type="button"
          disabled={busy || changes.length === 0}
          onClick={() => void send(changes)}
        >
          {busy ? copy.saving : copy.save}
        </button>
      </div>
      {changes.length === 0 && saving.step === "editing" && <p className={styles.hint}>{copy.nothing}</p>}
      {saving.step === "saved" && (
        <p className={styles.saved} role="status">
          {copy.saved(saving.changed)}
        </p>
      )}
      {saving.step === "failed" && (
        <p className={styles.error} role="alert">
          {copy.errors[saving.code] ?? copy.errors.unknown}
        </p>
      )}

      <fieldset className={styles.group}>
        <legend className={styles.ruleTitle}>{copy.upload.title}</legend>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="area-file">
            {copy.upload.label}
          </label>
          <input
            className={styles.text}
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
          <div className={styles.uploaded}>
            <p className={styles.saved} role="status">
              {upload.changes.length === 0 ? copy.upload.none : copy.upload.read(upload.changes.length)}
            </p>
            {upload.changes.length > 0 && (
              <div className={styles.actions}>
                <button className={styles.save} type="button" disabled={busy} onClick={() => void send(upload.changes)}>
                  {busy ? copy.saving : copy.upload.apply}
                </button>
                <button
                  className={styles.quiet}
                  type="button"
                  onClick={() => {
                    setUpload(null);
                  }}
                >
                  {copy.upload.cancel}
                </button>
              </div>
            )}
          </div>
        )}
        {upload?.step === "failed" && (
          <p className={styles.error} role="alert">
            {upload.says}
          </p>
        )}
      </fieldset>
    </section>
  );
}

export function ServiceArea() {
  const [loaded, retry] = useLoad(api.serviceArea);
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} />;
  return <Area pincodes={loaded.value.pincodes} />;
}
