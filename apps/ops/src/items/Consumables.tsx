// Items (docs/decisions/0087-consumables-and-stock.md): what a technician may record using on a job, what each costs
// us, its low levels, and what each service is expected to use. No client's invoice carries a consumable, so its cost
// is read only here. A row opens its record beside the list, where each value changes where it reads
// (docs/decisions/0212-editing-in-place.md).

import { Toast } from "@maneman/ui/Toast";
import { Apart } from "@maneman/ui/Apart";
import { PageActions } from "../frame/PageHead.tsx";
import { Badge } from "@maneman/ui/Badge";
import { EmptyState } from "@maneman/ui/EmptyState";
import { Panel } from "@maneman/ui/Panel";
import { FIGURE, Table } from "@maneman/ui/Table";
import { ViewRows } from "@maneman/ui/ListRow";
import { useIsPhone } from "../lib/media.ts";
import { TextButton } from "@maneman/ui/TextLink";
import { useLoad } from "@maneman/ui/useLoad";
import { rupees } from "@maneman/web-kit/money";
import { useState, type ReactNode } from "react";
import { type Consumable, type Consumables as ConsumableList } from "../api.ts";
import { DrawerButton } from "@maneman/ui/DrawerButton";
import { FormDrawer } from "@maneman/ui/FormDrawer";
import { Narrowing, SortHeads, TableEnd } from "@maneman/ui/TableTools";
import { useTableView, type Column } from "@maneman/ui/useTableView";
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

const cost = (consumable: Consumable) => consumable.unit_cost;

/** Each list's columns: what it is, what it is counted in, and what one costs us; each sorts. */
const COLUMNS = (first: string): readonly Column<Consumable>[] => [
  { label: first, sort: (row) => row.name },
  { label: copy.unitColumn, sort: (row) => row.unit, choice: (row) => row.unit },
  { label: copy.costColumn, sort: cost, figure: true },
];

function ConsumableRow({ consumable, onOpen }: { consumable: Consumable; onOpen: () => void }) {
  return (
    <tr>
      <RowHead>
        <TextButton compact aria-label={copy.open(consumable.name)} onClick={onOpen}>
          {consumable.name}
        </TextButton>
      </RowHead>
      <td>{consumable.unit}</td>
      <td className={FIGURE}>{consumable.unit_cost === 0 ? copy.noCost : rupees(consumable.unit_cost)}</td>
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
  const view = useTableView(props.rows, COLUMNS(props.first), { search: (row) => row.name });
  const phone = useIsPhone();
  if (props.rows.length === 0) return <EmptyState look="panel" line={props.none} />;
  if (phone) {
    return (
      <>
        <Narrowing view={view} label={copy.find} />
        <ViewRows
          rows={view.shown}
          label={props.first}
          row={(consumable) => ({
            key: consumable.code,
            title: consumable.name,
            meta: consumable.retired_from === null ? consumable.unit : `${consumable.unit} · ${stateWords(consumable)}`,
            end: consumable.unit_cost === 0 ? copy.noCost : rupees(consumable.unit_cost),
            endTone: "plain",
            label: copy.open(consumable.name),
            onClick: () => {
              props.onOpen(consumable.code);
            },
          })}
        />
        <TableEnd view={view} />
      </>
    );
  }
  return (
    <>
      <Narrowing view={view} label={copy.find} />
      <Table fixed className={styles.table}>
        <thead>
          <tr>
            <SortHeads view={view} />
            <th scope="col">
              <VisuallyHidden>{copy.stateColumn}</VisuallyHidden>
            </th>
          </tr>
        </thead>
        <tbody>
          {view.shown.map((consumable) => (
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
      <TableEnd view={view} />
    </>
  );
}

/**
 * One list's panel of what is in use, and beneath it, folded in a panel of its own, what is retired: an item retiring
 * later is still in use until then. The page's tables share their widths, so the lists line up.
 */
function ItemPanel(props: {
  titleId: string;
  title: string;
  retiredTitle: string;
  rows: readonly Consumable[];
  first: string;
  none: string;
  onOpen: (code: string) => void;
  children?: ReactNode;
}) {
  const inUse = props.rows.filter((each) => each.offered);
  const retired = props.rows.filter((each) => !each.offered);
  return (
    <>
      <Panel titleId={props.titleId} title={props.title}>
        {(inUse.length > 0 || retired.length === 0) && (
          <ConsumableTable rows={inUse} first={props.first} none={props.none} onOpen={props.onOpen} />
        )}
        {props.children}
      </Panel>
      {retired.length > 0 && (
        <Apart id={`${props.titleId}-retired`} title={props.retiredTitle} count={retired.length}>
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
      <ItemPanel
        titleId="consumables"
        title={copy.title}
        retiredTitle={copy.retiredConsumables}
        rows={current.consumables.filter((each) => each.hair_system === null)}
        first={copy.consumableColumn}
        none={copy.none}
        onOpen={opening}
      >
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
      </ItemPanel>
      <ItemPanel
        titleId="hair-systems"
        title={copy.hairSystems}
        retiredTitle={copy.retiredHairSystems}
        rows={current.consumables.filter((each) => each.hair_system !== null)}
        first={copy.hairSystemColumn}
        none={copy.noHairSystems}
        onOpen={opening}
      />
      <ServiceUsage consumables={current} onSaved={setConsumables} />
    </>
  );
}
