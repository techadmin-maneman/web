// Items (docs/decisions/0087-consumables-and-stock.md): what a technician may record using on a job, what each costs
// us, its low levels, and what each service is expected to use. No client's invoice carries a consumable, so its cost
// is read only here. A row opens its record beside the list, where each value changes where it reads
// (docs/decisions/0212-editing-in-place.md).

import { Toast } from "@maneman/ui/Toast";
import { Apart } from "@maneman/ui/Apart";
import { PageActions } from "../frame/PageHead.tsx";
import { Badge } from "@maneman/ui/Badge";
import { Note } from "@maneman/ui/Note";
import { Panel } from "@maneman/ui/Panel";
import { FIGURE, Table } from "@maneman/ui/Table";
import { TextButton } from "@maneman/ui/TextLink";
import { useLoad } from "@maneman/ui/useLoad";
import { rupees } from "@maneman/web-kit/money";
import { useState } from "react";
import { type Consumable, type Consumables as ConsumableList } from "../api.ts";
import { DrawerButton } from "@maneman/ui/DrawerButton";
import { FormDrawer } from "@maneman/ui/FormDrawer";
import { ListTools } from "@maneman/ui/ListTools";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { RowHead } from "@maneman/ui/RowHead";
import { settings } from "../content/settings.ts";
import { useAccess } from "../lib/access.ts";
import { PanelLoading, PanelFailed } from "@maneman/ui/States";
import { AddConsumable } from "./ConsumableForm.tsx";
import { ConsumableRecord } from "./ConsumableRecord.tsx";
import { stateWords } from "./Retirement.tsx";
import { ServiceUsage } from "./ServiceUsage.tsx";
import styles from "./consumables.module.css";
import { itemsApi } from "./items-api.ts";

const copy = settings.consumables;

function ConsumableRow({ consumable, onOpen }: { consumable: Consumable; onOpen: () => void }) {
  return (
    <tr>
      <RowHead>
        <TextButton compact aria-label={copy.open(consumable.name)} onClick={onOpen}>
          {consumable.name}
        </TextButton>{" "}
        <span className={styles.unit}>{consumable.unit}</span>
      </RowHead>
      <td className={FIGURE}>{consumable.unit_cost === 0 ? copy.noCost : rupees(consumable.unit_cost)}</td>
      <td>
        {copy.levels({
          kit: consumable.reorder_kit,
          store: consumable.reorder_store,
          central: consumable.reorder_central,
        })}
      </td>
      <td>
        {/* In use says nothing: only a retirement, still to come or past, is a state worth a word. */}
        {consumable.retired_from !== null && (
          <Badge tone={consumable.offered ? "attention" : "neutral"}>{stateWords(consumable)}</Badge>
        )}
      </td>
    </tr>
  );
}

function ConsumableTable(props: {
  rows: readonly Consumable[];
  /** The first column's name: "Consumable", "Hair system". */
  first: string;
  none: string;
  onOpen: (code: string) => void;
}) {
  if (props.rows.length === 0) return <Note>{props.none}</Note>;
  return (
    <ListTools rows={props.rows} textOf={(each) => each.name} label={copy.find}>
      {(shown) => (
        <Table fixed className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{props.first}</th>
              <th scope="col" className={FIGURE}>
                {copy.costColumn}
              </th>
              <th scope="col">{copy.levelsColumn}</th>
              <th scope="col">
                <VisuallyHidden>{copy.stateColumn}</VisuallyHidden>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((consumable) => (
              <ConsumableRow
                key={consumable.code}
                consumable={consumable}
                onOpen={() => {
                  props.onOpen(consumable.code);
                }}
              />
            ))}
          </tbody>
        </Table>
      )}
    </ListTools>
  );
}

/**
 * What is in use, and apart beneath it what is retired: an item retiring later is still in use until then. Every list
 * on the page is one table at the same widths, so the consumables, the hair systems and those retired line up.
 */
function InUseAndRetired(props: {
  id: string;
  rows: readonly Consumable[];
  first: string;
  none: string;
  onOpen: (code: string) => void;
}) {
  const inUse = props.rows.filter((each) => each.offered);
  const retired = props.rows.filter((each) => !each.offered);
  return (
    <>
      {(inUse.length > 0 || retired.length === 0) && (
        <ConsumableTable rows={inUse} first={props.first} none={props.none} onOpen={props.onOpen} />
      )}
      {retired.length > 0 && (
        <Apart id={props.id} title={copy.retiredTitle}>
          <ConsumableTable rows={retired} first={props.first} none="" onOpen={props.onOpen} />
        </Apart>
      )}
    </>
  );
}

export function Consumables() {
  const [loaded, retry] = useLoad(itemsApi.consumables);
  /** The list after a change, so the table follows without reading it again. */
  const [consumables, setConsumables] = useState<ConsumableList | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const mayAdd = useAccess().mayCall("POST /api/consumables");

  if (loaded.state === "loading") return <PanelLoading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const current = consumables ?? loaded.value;
  const opened = current.consumables.find((each) => each.code === open);
  const close = () => {
    setOpen(null);
  };
  const opening = (code: string) => {
    setOpen(code);
    setSaid(null);
  };

  return (
    <>
      <PageActions>
        {mayAdd && (
          <DrawerButton primary label={copy.add}>
            {(done) => (
              <AddConsumable
                maxUnitCost={current.max_unit_cost}
                onAdded={(next) => {
                  setConsumables(next);
                  setSaid(copy.form.added);
                  done();
                }}
                onCancel={done}
              />
            )}
          </DrawerButton>
        )}
      </PageActions>
      <Panel titleId="consumables" title={copy.title}>
        <InUseAndRetired
          id="consumables-retired"
          rows={current.consumables.filter((each) => each.hair_system === null)}
          first={copy.consumableColumn}
          none={copy.none}
          onOpen={opening}
        />
        {said !== null && <Toast>{said}</Toast>}
        {opened !== undefined && (
          <FormDrawer title={opened.name} onClose={close}>
            <ConsumableRecord
              consumable={opened}
              consumables={current}
              onSaved={setConsumables}
              onDeleted={(next) => {
                setConsumables(next);
                setSaid(copy.deleted);
                close();
              }}
            />
          </FormDrawer>
        )}
      </Panel>
      <Panel titleId="hair-systems" title={copy.hairSystems}>
        <InUseAndRetired
          id="hair-systems-retired"
          rows={current.consumables.filter((each) => each.hair_system !== null)}
          first={copy.hairSystemColumn}
          none={copy.noHairSystems}
          onOpen={opening}
        />
      </Panel>
      <ServiceUsage consumables={current} onSaved={setConsumables} />
    </>
  );
}
