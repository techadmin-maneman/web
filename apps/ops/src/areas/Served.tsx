// Settings › Areas: where we go, and from when (docs/decisions/0061-ops-editable-inputs.md; the pincodes are kept in
// data/pincodes/README.md). Each change saves as it is made: a pincode from its drawer, the chosen ones once asked, a
// file once its changes are shown. One that would message people waiting opens the launch panel first
// (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).

import { Toast } from "@maneman/ui/Toast";
import { Checkbox, Fieldset } from "@maneman/ui/Field";
import { Panel } from "@maneman/ui/Panel";
import { Button } from "@maneman/ui/Button";
import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
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
import { readServiceAreaCsv, serviceAreaCsv } from "./csv.ts";
import { AREA_NAME } from "./rules.ts";
import {
  changesIn,
  chosenServed,
  fileChanges,
  fileDraft,
  servesLater,
  uploadRefusal,
  type Row,
} from "./served-draft.ts";
import { CityTabs, PincodeRow, SaveNotes, UploadFile, type Upload } from "./ServedParts.tsx";
import { AskingCheck, ChosenBar } from "./Chosen.tsx";
import { useAreaSaves } from "./useAreaSaves.ts";
import { areasApi } from "./areas-api.ts";

const copy = areas.served;

const servedWord = (row: ServedPincode) => (row.served ? copy.yes : copy.no);
const [PIN, NAME, SERVED, LAUNCH, WAITING] = copy.columns;
const COLUMNS: readonly Column<ServedPincode>[] = [
  { label: PIN, sort: (row) => row.pincode },
  { label: NAME, sort: (row) => row.area },
  { label: SERVED, sort: servedWord, choice: servedWord },
  { label: LAUNCH, sort: (row) => row.launch_on ?? "" },
  { label: WAITING, sort: (row) => row.waiting },
];

/** A city's pincodes, narrowed and sorted as ops ask; where ops may change them, each with a box to choose it. */
function PincodeTable(props: {
  view: ReturnType<typeof useTableView<ServedPincode>>;
  chosen: ReadonlySet<string> | null;
  onChosen: (next: ReadonlySet<string>) => void;
  onSave: (pincode: string, next: Row) => string | null;
}) {
  const { view, chosen, onChosen } = props;
  const shown = view.shown.map((each) => each.pincode);
  const choose = (pincodes: readonly string[], on: boolean) => {
    const next = new Set(chosen);
    for (const each of pincodes) {
      if (on) next.add(each);
      else next.delete(each);
    }
    onChosen(next);
  };
  return (
    <>
      <Narrowing view={view} label={copy.narrow} />
      <Table controls>
        <thead>
          <tr>
            {chosen !== null && (
              <th scope="col">
                <Checkbox
                  aria-label={copy.chosen.all}
                  checked={shown.length > 0 && shown.every((each) => chosen.has(each))}
                  onChange={(event) => {
                    choose(shown, event.target.checked);
                  }}
                />
              </th>
            )}
            <SortHeads view={view} />
            {chosen !== null && (
              <th scope="col">
                <VisuallyHidden>{copy.edit}</VisuallyHidden>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {view.shown.map((each) => (
            <PincodeRow
              key={each.pincode}
              pincode={each}
              chosen={chosen === null ? null : chosen.has(each.pincode)}
              onChoose={(on) => {
                choose([each.pincode], on);
              }}
              onSave={(next) => props.onSave(each.pincode, next)}
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
      {added !== null && <Toast>{areas.add.added(added.pincode, added.city)}</Toast>}
    </Fieldset>
  );
}

function Area({ pincodes: loadedPincodes, cities }: { pincodes: readonly ServedPincode[]; cities: readonly string[] }) {
  const [pincodes, setPincodes] = useState<readonly ServedPincode[]>(loadedPincodes);
  const [city, setCity] = useState(pincodes[0]?.city ?? "");
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [upload, setUpload] = useState<Upload | null>(null);
  const [added, setAdded] = useState<ServedPincode | null>(null);
  const access = useAccess();
  const mayChange = access.mayCall("POST /api/service-area");
  const mayAdd = access.mayCall("POST /api/pincodes");
  const saves = useAreaSaves(pincodes, setPincodes, () => {
    setChosen(new Set());
    setUpload(null);
  });
  const inCity = pincodes.filter((each) => each.city === city);
  const view = useTableView(inCity, COLUMNS, { search: (row) => `${row.pincode} ${row.area}` });

  /** A row's settings from its drawer: sent at once, or why they cannot go. */
  const saveRow = (pincode: string, next: Row): string | null => {
    const [change] = changesIn(pincodes, { [pincode]: next });
    if (change === undefined) return null;
    if (change.area !== undefined && !AREA_NAME.test(change.area)) return copy.badName(pincode);
    if (servesLater(pincodes, change, todayInIndia(Date.now()))) return copy.later(pincode);
    saves.commit([change]);
    return null;
  };

  const serveChosen = (served: boolean) => {
    const question = served ? copy.chosen.serveCheck : copy.chosen.stopCheck;
    saves.commit(changesIn(pincodes, chosenServed(pincodes, chosen, served)), question(chosen.size, city));
  };

  const readFile = async (file: File) => {
    const read = readServiceAreaCsv(await file.text());
    if (read.ok) setUpload({ step: "read", rows: fileChanges(pincodes, read.rows) });
    else setUpload({ step: "failed", says: uploadRefusal(read) });
  };

  return (
    <Panel
      titleId="area"
      title={copy.title}
      padded
      actions={
        <Button
          variant="outline"
          size="small"
          narrow
          onClick={() => {
            saveFile(copy.downloadName, serviceAreaCsv(pincodes), "text/csv");
          }}
        >
          {copy.download}
        </Button>
      }
    >
      <CityTabs
        pincodes={pincodes}
        city={city}
        onCity={(next) => {
          setCity(next);
          setChosen(new Set());
        }}
      />
      {chosen.size > 0 && saves.asking === null && (
        <ChosenBar
          count={chosen.size}
          onServe={serveChosen}
          onClear={() => {
            setChosen(new Set());
          }}
        />
      )}
      {saves.asking !== null && (
        <AskingCheck
          asking={saves.asking}
          busy={saves.saving.step === "saving"}
          onSend={() => void saves.send(saves.asking?.changes ?? [])}
          onCancel={saves.cancel}
        />
      )}
      <SaveNotes saving={saves.saving} />
      <PincodeTable view={view} chosen={mayChange ? chosen : null} onChosen={setChosen} onSave={saveRow} />
      {mayChange && (
        <UploadFile
          upload={upload}
          onFile={(file) => void readFile(file)}
          onApply={(rows) => {
            saves.commit(changesIn(pincodes, fileDraft(rows)));
          }}
          onCancel={() => {
            setUpload(null);
          }}
        />
      )}
      {mayAdd && (
        <AddBeneath
          cities={cities}
          added={added}
          onAdded={(held) => {
            setPincodes((all) => [...all, held]);
            setCity(held.city);
            setAdded(held);
          }}
        />
      )}
    </Panel>
  );
}

export function Served() {
  const [loaded, retry] = useLoad(areasApi.serviceArea);
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  return <Area pincodes={loaded.value.pincodes} cities={loaded.value.cities} />;
}
