// Areas' Served tab: where we go, and from when (docs/decisions/0061-ops-editable-inputs.md).
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
// launch, so a save that would message people waiting there opens the launch
// panel Waiting uses first (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).
// A pincode the file does not hold is added beneath the table.

import { Button } from "@maneman/ui/Button";
import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { indiaDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { api, type ServedPincode } from "../api.ts";
import { areas } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import styles from "../settings/settings.module.css";
import { Loading, PanelFailed } from "../states/States.tsx";
import { AddPincode } from "./AddPincode.tsx";
import areaStyles from "./areas.module.css";
import { readServiceAreaCsv, serviceAreaCsv } from "./csv.ts";
import { AREA_NAME } from "./rules.ts";
import {
  afterSave,
  changesIn,
  draftOf,
  fileChanges,
  launchesIn,
  rowOf,
  servesLater,
  uploadRefusal,
  withCity,
  withFile,
  type Draft,
  type FileChange,
} from "./served-draft.ts";
import { CityTabs, LaunchCheck, PincodeRow, SaveNotes, UploadFile, type Saving, type Upload } from "./ServedParts.tsx";

const copy = areas.served;

function Area({ pincodes: loadedPincodes, cities }: { pincodes: readonly ServedPincode[]; cities: readonly string[] }) {
  const [pincodes, setPincodes] = useState(loadedPincodes);
  const [city, setCity] = useState(pincodes[0]?.city ?? "");
  const [draft, setDraft] = useState<Draft>(() => draftOf(loadedPincodes));
  const [saving, setSaving] = useState<Saving>({ step: "editing" });
  const [upload, setUpload] = useState<Upload | null>(null);
  const [added, setAdded] = useState<ServedPincode | null>(null);
  const access = useAccess();
  const mayChange = access.mayCall("POST /api/service-area");
  const mayAdd = access.mayCall("POST /api/pincodes");
  const today = indiaDate(new Date().toISOString());

  const inCity = pincodes.filter((each) => each.city === city);
  const changes = changesIn(pincodes, draft);
  const badName = changes.find((change) => change.area !== undefined && !AREA_NAME.test(change.area));
  const later = changes.find((change) => servesLater(pincodes, change, today));
  const launching = launchesIn(pincodes, changes);
  const busy = saving.step === "saving";

  /** A pincode added beneath the table joins it, unserved, in its city. */
  const addedHere = (held: ServedPincode) => {
    setPincodes((all) => [...all, held]);
    setDraft((now) => ({ ...now, [held.pincode]: rowOf(held) }));
    setCity(held.city);
    setAdded(held);
  };

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
    // The change is made, so what was a draft is now what we hold.
    setPincodes((held) => afterSave(held, changes));
    setSaving({ step: "saved", changed: answer.body.changed, alerted: answer.body.alerted });
  };

  const readFile = async (file: File) => {
    const read = readServiceAreaCsv(await file.text());
    if (read.ok) setUpload({ step: "read", rows: fileChanges(pincodes, draft, read.rows) });
    else setUpload({ step: "failed", says: uploadRefusal(read) });
  };

  const applyFile = (rows: readonly FileChange[]) => {
    edit(withFile(draft, rows));
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

      <CityTabs
        pincodes={pincodes}
        draft={draft}
        city={city}
        mayChange={mayChange}
        onCity={setCity}
        onBulk={(served) => {
          edit(withCity(draft, inCity, served));
        }}
      />

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
        <div className={areaStyles.inPanel}>
          <LaunchCheck
            launching={launching}
            busy={busy}
            onSend={() => void send()}
            onCancel={() => {
              setSaving({ step: "editing" });
            }}
          />
        </div>
      )}
      {!checking && mayChange && (
        <div className={styles.actions}>
          <Button
            variant="primary"
            size="small"
            className={styles.save}
            disabled={busy || changes.length === 0 || badName !== undefined || later !== undefined}
            onClick={pressSave}
          >
            {busy ? copy.saving : copy.save}
          </Button>
        </div>
      )}
      <SaveNotes saving={saving} changes={changes} badName={badName} later={later} mayChange={mayChange} />

      {mayChange && (
        <UploadFile
          upload={upload}
          onFile={(file) => void readFile(file)}
          onApply={applyFile}
          onCancel={() => {
            setUpload(null);
          }}
        />
      )}

      {mayAdd && (
        <fieldset className={styles.group}>
          <legend className={styles.ruleTitle}>{areas.add.title}</legend>
          <AddPincode pincode={null} cities={cities} onAdded={addedHere} />
          {added !== null && (
            <p className={styles.saved} role="status">
              {areas.add.added(added.pincode, added.city)}
            </p>
          )}
        </fieldset>
      )}
    </section>
  );
}

export function Served() {
  const [loaded, retry] = useLoad(api.serviceArea);
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  return <Area pincodes={loaded.value.pincodes} cities={loaded.value.cities} />;
}
