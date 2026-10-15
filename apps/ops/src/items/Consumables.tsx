// Settings, Consumables (docs/decisions/0087-consumables-and-stock.md): what a technician may record using on a job,
// what each costs us, its low levels, and what each service is expected to use. No client's invoice carries a
// consumable, so its cost is read only here. Hair systems are listed too, counted in pieces
// (docs/decisions/0156-hair-systems-in-stock.md).

import { InlineMessage } from "@maneman/ui/InlineMessage";
import { RowButton } from "@maneman/ui/Button";
import { Note } from "@maneman/ui/Note";
import { Panel } from "@maneman/ui/Panel";
import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { longDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { useState } from "react";
import { type Consumable, type Consumables as ConsumableList } from "../api.ts";
import { errorText } from "@maneman/web-kit/refusal";
import { deleting } from "../content.ts";
import { settings } from "../content/settings.ts";
import { DeleteAction } from "../components/DeleteAction.tsx";
import { useAccess } from "../lib/access.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { ConsumableForm } from "./ConsumableForm.tsx";
import { HairSystemForm } from "./HairSystemForm.tsx";
import { Restoring, Retiring } from "./Retirement.tsx";
import { ServiceUsage } from "./ServiceUsage.tsx";
import styles from "./consumables.module.css";
import form from "../components/forms.module.css";
import { RowHead } from "../components/RowHead.tsx";
import { itemsApi } from "./items-api.ts";

import { DrawerButton } from "../components/DrawerButton.tsx";
import { FormDrawer } from "../components/FormDrawer.tsx";

const copy = settings.consumables;

/** What the panel's form is doing: adding one, or changing, retiring or restoring the one named. */
type Doing =
  { readonly kind: "add" } | { readonly kind: "change" | "retire" | "restore" | "delete"; readonly code: string };

/** Which of those the person's access lets them do. */
type MayDo = Readonly<Record<Doing["kind"] | "addHairSystem", boolean>>;

function useMayDo(): MayDo {
  const access = useAccess();
  return {
    add: access.mayCall("POST /api/consumables"),
    change: access.mayCall("POST /api/consumables/{code}"),
    retire: access.mayCall("POST /api/consumables/{code}/retire"),
    restore: access.mayCall("POST /api/consumables/{code}/restore"),
    delete: access.mayCall("POST /api/consumables/{code}/delete"),
    addHairSystem: access.mayCall("POST /api/hair-systems"),
  };
}

function stateWords(consumable: Consumable): string {
  if (consumable.retired_from === null) return copy.states.offered;
  const from = longDate(consumable.retired_from);
  return consumable.offered ? copy.states.retiring(from) : copy.states.retired(from);
}

function ConsumableRow({
  consumable,
  may,
  onDo,
}: {
  consumable: Consumable;
  may: MayDo;
  onDo: (doing: Doing) => void;
}) {
  const { code, name } = consumable;
  const notRetired = consumable.retired_from === null;
  return (
    <tr>
      <RowHead>
        {name} <span className={styles.unit}>{consumable.unit}</span>
      </RowHead>
      <td className={form.figure}>{rupees(consumable.unit_cost)}</td>
      <td>
        {copy.levels({
          kit: consumable.reorder_kit,
          store: consumable.reorder_store,
          central: consumable.reorder_central,
        })}
      </td>
      <td className={styles.actions}>
        <span className={consumable.offered ? undefined : styles.quiet}>{stateWords(consumable)}</span>
        {may.change && (
          <RowButton
            beside
            aria-label={copy.changeLabel(name)}
            onClick={() => {
              onDo({ kind: "change", code });
            }}
          >
            {copy.change}
          </RowButton>
        )}
        {notRetired && may.retire && (
          <RowButton
            beside
            aria-label={copy.retireLabel(name)}
            onClick={() => {
              onDo({ kind: "retire", code });
            }}
          >
            {copy.retire}
          </RowButton>
        )}
        {!notRetired && may.restore && (
          <RowButton
            beside
            aria-label={copy.restoreLabel(name)}
            onClick={() => {
              onDo({ kind: "restore", code });
            }}
          >
            {copy.restore}
          </RowButton>
        )}
        {may.delete && (
          <RowButton
            beside
            aria-label={deleting.label(name)}
            onClick={() => {
              onDo({ kind: "delete", code });
            }}
          >
            {deleting.open}
          </RowButton>
        )}
      </td>
    </tr>
  );
}

/** The drawer a row's button opened; nothing while none is open. */
function ConsumableEditor({
  consumables,
  doing,
  onSaved,
  onCancel,
}: {
  consumables: ConsumableList;
  doing: Doing;
  onSaved: (consumables: ConsumableList, said: string) => void;
  onCancel: () => void;
}) {
  const named = doing.kind === "add" ? undefined : consumables.consumables.find((each) => each.code === doing.code);
  if (named === undefined || doing.kind === "add") return null;
  return (
    <FormDrawer title={named.name} onClose={onCancel}>
      <ConsumableChange named={named} consumables={consumables} doing={doing} onSaved={onSaved} onCancel={onCancel} />
    </FormDrawer>
  );
}

/** What a consumable's row opened: its change, its deletion, or its retirement. */
function ConsumableChange({
  named,
  consumables,
  doing,
  onSaved,
  onCancel,
}: {
  named: ConsumableList["consumables"][number];
  consumables: ConsumableList;
  doing: Exclude<Doing, { kind: "add" }>;
  onSaved: (consumables: ConsumableList, said: string) => void;
  onCancel: () => void;
}) {
  if (doing.kind === "change") {
    return (
      <ConsumableForm
        key={named.code}
        consumable={named}
        maxUnitCost={consumables.max_unit_cost}
        onSaved={onSaved}
        onCancel={onCancel}
      />
    );
  }
  if (doing.kind === "delete") {
    return (
      <div className={form.group}>
        <DeleteAction
          key={`delete-${named.code}`}
          name={named.name}
          send={() => itemsApi.deleteConsumable(named.code)}
          refusal={(code) => (code === "in_use" ? copy.inUse : errorText(copy.errors, { code }))}
          onDeleted={(body) => {
            onSaved(body, copy.deleted);
          }}
          onCancel={onCancel}
        />
      </div>
    );
  }
  if (doing.kind === "restore") {
    return <Restoring key={`restore-${named.code}`} consumable={named} onSaved={onSaved} onCancel={onCancel} />;
  }
  return (
    <Retiring
      key={`retire-${named.code}`}
      consumable={named}
      today={consumables.today}
      onSaved={onSaved}
      onCancel={onCancel}
    />
  );
}

/** Adding a consumable, and a hair system, from the list's head, as the person's access allows. */
function AddButtons({
  consumables,
  may,
  onSaved,
}: {
  consumables: ConsumableList;
  may: ReturnType<typeof useMayDo>;
  onSaved: (consumables: ConsumableList, said: string) => void;
}) {
  return (
    <>
      {may.add && (
        <DrawerButton label={copy.add}>
          {(close) => (
            <ConsumableForm
              consumable={null}
              maxUnitCost={consumables.max_unit_cost}
              onSaved={(next, words) => {
                onSaved(next, words);
                close();
              }}
              onCancel={close}
            />
          )}
        </DrawerButton>
      )}
      {may.addHairSystem && (
        <DrawerButton label={copy.hairSystems.add}>
          {(close) => (
            <HairSystemForm
              consumables={consumables}
              onSaved={(next, words) => {
                onSaved(next, words);
                close();
              }}
            />
          )}
        </DrawerButton>
      )}
    </>
  );
}

export function Consumables() {
  const [loaded, retry] = useLoad(itemsApi.consumables);
  /** The list after a change, so the table follows without reading it again. */
  const [consumables, setConsumables] = useState<ConsumableList | null>(null);
  const [doing, setDoing] = useState<Doing>({ kind: "add" });
  const [said, setSaid] = useState<string | null>(null);
  const may = useMayDo();

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const current = consumables ?? loaded.value;

  const saved = (next: ConsumableList, words: string) => {
    setConsumables(next);
    setDoing({ kind: "add" });
    setSaid(words);
  };

  return (
    <>
      <Panel
        titleId="consumables"
        title={copy.title}
        padded
        actions={<AddButtons consumables={current} may={may} onSaved={saved} />}
      >
        {current.consumables.length === 0 ? (
          <Note>{copy.none}</Note>
        ) : (
          <Table controls>
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
              {current.consumables.map((consumable) => (
                <ConsumableRow
                  key={consumable.code}
                  consumable={consumable}
                  may={may}
                  onDo={(next) => {
                    setDoing(next);
                    setSaid(null);
                  }}
                />
              ))}
            </tbody>
          </Table>
        )}
        {said !== null && (
          <InlineMessage tone="saved" className={form.saved}>
            {said}
          </InlineMessage>
        )}
        <ConsumableEditor
          consumables={current}
          doing={doing}
          onSaved={saved}
          onCancel={() => {
            setDoing({ kind: "add" });
          }}
        />
      </Panel>
      <ServiceUsage consumables={current} onSaved={setConsumables} />
    </>
  );
}
