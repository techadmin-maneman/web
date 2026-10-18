// Items (docs/decisions/0087-consumables-and-stock.md): what a technician may record using on a job, what each costs
// us, its low levels, and what each service is expected to use. No client's invoice carries a consumable, so its cost
// is read only here. A row opens its record beside the list, where each value changes where it reads
// (docs/decisions/0212-editing-in-place.md).

import { InlineMessage } from "@maneman/ui/InlineMessage";
import { Note } from "@maneman/ui/Note";
import { Panel } from "@maneman/ui/Panel";
import { Table } from "@maneman/ui/Table";
import { TextButton } from "@maneman/ui/TextLink";
import { useLoad } from "@maneman/ui/useLoad";
import { rupees } from "@maneman/web-kit/money";
import { useState } from "react";
import { type Consumable, type Consumables as ConsumableList } from "../api.ts";
import { DrawerButton } from "../components/DrawerButton.tsx";
import { FormDrawer } from "../components/FormDrawer.tsx";
import { RowHead } from "../components/RowHead.tsx";
import form from "../components/forms.module.css";
import { settings } from "../content/settings.ts";
import { useAccess } from "../lib/access.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
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
      <td className={form.figure}>{rupees(consumable.unit_cost)}</td>
      <td>
        {copy.levels({
          kit: consumable.reorder_kit,
          store: consumable.reorder_store,
          central: consumable.reorder_central,
        })}
      </td>
      <td className={consumable.offered ? undefined : styles.quiet}>{stateWords(consumable)}</td>
    </tr>
  );
}

function ConsumableTable(props: { consumables: ConsumableList; onOpen: (code: string) => void }) {
  if (props.consumables.consumables.length === 0) return <Note>{copy.none}</Note>;
  return (
    <Table>
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
        {props.consumables.consumables.map((consumable) => (
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
  );
}

export function Consumables() {
  const [loaded, retry] = useLoad(itemsApi.consumables);
  /** The list after a change, so the table follows without reading it again. */
  const [consumables, setConsumables] = useState<ConsumableList | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const mayAdd = useAccess().mayCall("POST /api/consumables");

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const current = consumables ?? loaded.value;
  const opened = current.consumables.find((each) => each.code === open);
  const close = () => {
    setOpen(null);
  };

  return (
    <>
      <Panel
        titleId="consumables"
        title={copy.title}
        padded
        actions={
          mayAdd && (
            <DrawerButton label={copy.add}>
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
          )
        }
      >
        <ConsumableTable
          consumables={current}
          onOpen={(code) => {
            setOpen(code);
            setSaid(null);
          }}
        />
        {said !== null && (
          <InlineMessage tone="saved" className={form.saved}>
            {said}
          </InlineMessage>
        )}
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
      <ServiceUsage consumables={current} onSaved={setConsumables} />
    </>
  );
}
