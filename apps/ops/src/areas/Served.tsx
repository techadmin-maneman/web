// Areas' Served tab: where we go, and from when (docs/decisions/0061-ops-editable-inputs.md). The pincodes live in a
// spreadsheet (data/pincodes/README.md), so the tab does two things: launch one area, and take the whole file back,
// shown pincode by pincode before the one Save. A save that would message people waiting opens the launch panel first
// (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).

import { InlineMessage } from "@maneman/ui/InlineMessage";
import { Fieldset } from "@maneman/ui/Field";
import { Panel } from "@maneman/ui/Panel";
import { Button } from "@maneman/ui/Button";
import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { todayInIndia } from "@maneman/web-kit/dates";
import { useState } from "react";
import { type ServedPincode } from "../api.ts";
import { areas } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { saveFile } from "../lib/save-file.ts";
import form from "../components/forms.module.css";
import { Loading, PanelFailed } from "../states/States.tsx";
import { Narrowing, SortHeads, TableEnd } from "../components/TableTools.tsx";
import { useTableView, type Column } from "../components/useTableView.ts";
import { AddPincode } from "./AddPincode.tsx";
import styles from "./served.module.css";
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
import { FormActions } from "../components/FormActions.tsx";
import { areasApi } from "./areas-api.ts";

const copy = areas.served;

// Sorted and narrowed by what is saved, so a row stays put while its boxes are typed in.
const servedWord = (row: ServedPincode) => (row.served ? copy.yes : copy.no);
const [PIN, NAME, SERVED, LAUNCH, WAITING] = copy.columns;
const COLUMNS: readonly Column<ServedPincode>[] = [
  { label: PIN, sort: (row) => row.pincode },
  { label: NAME, sort: (row) => row.area },
  { label: SERVED, sort: servedWord, choice: servedWord },
  { label: LAUNCH, sort: (row) => row.launch_on ?? "" },
  { label: WAITING, sort: (row) => row.waiting },
];

/** A city's pincodes, narrowed and sorted as ops ask, each row's boxes holding the draft. */
function PincodeTable(props: {
  view: ReturnType<typeof useTableView<ServedPincode>>;
  draft: Draft;
  mayChange: boolean;
  onEdit: (next: Draft) => void;
}) {
  const { view, draft, mayChange, onEdit } = props;
  return (
    <>
      <Narrowing view={view} label={copy.narrow} />
      <Table className={form.table}>
        <thead>
          <tr>
            <SortHeads view={view} />
          </tr>
        </thead>
        <tbody>
          {view.shown.map((each) => (
            <PincodeRow
              key={each.pincode}
              pincode={each}
              row={draft[each.pincode] ?? rowOf(each)}
              mayChange={mayChange}
              onChange={(next) => {
                onEdit({ ...draft, [each.pincode]: next });
              }}
            />
          ))}
        </tbody>
      </Table>
      <TableEnd view={view} />
    </>
  );
}

/** A pincode the file does not hold, added beneath the table, and what was added last. */
function AddBeneath(props: {
  cities: readonly string[];
  added: ServedPincode | null;
  onAdded: (held: ServedPincode) => void;
}) {
  const { added } = props;
  return (
    <Fieldset className={form.group} legend={areas.add.title} legendLook="title">
      <AddPincode pincode={null} cities={props.cities} onAdded={props.onAdded} />
      {added !== null && (
        <InlineMessage tone="saved" className={form.saved}>
          {areas.add.added(added.pincode, added.city)}
        </InlineMessage>
      )}
    </Fieldset>
  );
}

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
  const today = todayInIndia(Date.now());

  const inCity = pincodes.filter((each) => each.city === city);
  const view = useTableView(inCity, COLUMNS, { search: (row) => `${row.pincode} ${row.area}` });
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
    const answer = await areasApi.setServiceArea(changes);
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
    saveFile(copy.downloadName, serviceAreaCsv(pincodes), "text/csv");
  };

  const pressSave = () => {
    if (launching.length > 0) setSaving({ step: "checking" });
    else void send();
  };

  const checking = saving.step === "checking" || (saving.step === "saving" && launching.length > 0);

  return (
    <Panel
      titleId="area"
      title={copy.title}
      className={form.panel}
      actions={
        <Button variant="outline" size="small" className={form.quiet} onClick={download}>
          {copy.download}
        </Button>
      }
    >
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

      <PincodeTable view={view} draft={draft} mayChange={mayChange} onEdit={edit} />

      {checking && (
        <div className={styles.inPanel}>
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
        <FormActions>
          <Button
            variant="primary"
            size="small"
            disabled={busy || changes.length === 0 || badName !== undefined || later !== undefined}
            onClick={pressSave}
          >
            {busy ? copy.saving : copy.save}
          </Button>
        </FormActions>
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

      {mayAdd && <AddBeneath cities={cities} added={added} onAdded={addedHere} />}
    </Panel>
  );
}

export function Served() {
  const [loaded, retry] = useLoad(areasApi.serviceArea);
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  return <Area pincodes={loaded.value.pincodes} cities={loaded.value.cities} />;
}
