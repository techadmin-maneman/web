// The zones that group cities, as NCR does, each with the cities in it; a grant of staff access may name one
// (docs/decisions/0109-console-departments-and-access.md). A zone is added, renamed and deleted here, while nothing
// names it, and a city put in it from its row.

import { ACTION_ICONS } from "@maneman/brand/action-icons";
import { Toast } from "@maneman/ui/Toast";
import { Note } from "@maneman/ui/Note";
import { Panel } from "@maneman/ui/Panel";
import { DrawerButton } from "@maneman/ui/DrawerButton";
import { DeleteAction } from "@maneman/ui/DeleteAction";
import { FormDrawer } from "@maneman/ui/FormDrawer";
import { TextRow } from "@maneman/ui/RecordRows";
import { RowOpener, Table } from "@maneman/ui/Table";
import { errorText } from "@maneman/web-kit/refusal";
import { SortHeads, TableEnd } from "@maneman/ui/TableTools";
import { useTableView, type Column } from "@maneman/ui/useTableView";
import { Field, TextInput } from "@maneman/ui/Field";
import { RowHead } from "@maneman/ui/RowHead";
import { AddForm } from "@maneman/ui/AddForm";
import { useState } from "react";
import { cities as citiesCopy } from "../content/cities.ts";
import { useAccess } from "../lib/access.ts";
import form from "@maneman/ui/forms.module.css";
import type { Cities } from "./types.ts";
import { citiesApi } from "./cities-api.ts";

const copy = citiesCopy.zones;

function ZoneForm({ onAdded, onCancel }: { onAdded: () => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState("");
  return (
    <AddForm
      title={copy.add}
      words={{ add: citiesCopy.form.add }}
      errors={copy.errors}
      boxes={["name"]}
      send={() => citiesApi.addZone({ name: name.trim() })}
      onAdded={onAdded}
      onCancel={onCancel}
    >
      <div className={form.fields}>
        <Field label={copy.name} className={form.field} box="name">
          {(control) => (
            <TextInput
              {...control}
              width="area"
              maxLength={40}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          )}
        </Field>
      </div>
    </AddForm>
  );
}

/** A zone's record: its name, changed in place, and, while nothing names it, the way to delete it. */
function ZoneRecord(props: {
  readonly zone: string;
  readonly deletable: boolean;
  readonly mayChange: boolean;
  readonly onRenamed: (name: string) => Promise<void>;
  readonly onDeleted: () => Promise<void>;
}) {
  const { zone, mayChange } = props;
  return (
    <>
      <div className={form.record}>
        <TextRow
          label={copy.name}
          value={zone}
          maxLength={40}
          mayChange={mayChange}
          save={async (typed) => {
            const answer = await citiesApi.renameZone(zone, typed.trim());
            if (!answer.ok) return errorText(copy.errors, answer);
            await props.onRenamed(typed.trim());
            return null;
          }}
        />
      </div>
      {mayChange && (
        <div className={form.recordFoot}>
          {props.deletable ? (
            <DeleteAction
              name={zone}
              send={() => citiesApi.deleteZone(zone)}
              refusal={(code) => errorText(copy.errors, { code })}
              onDeleted={() => void props.onDeleted()}
            />
          ) : (
            <Note>{copy.inUse}</Note>
          )}
        </div>
      )}
    </>
  );
}

/** The zone opened from its row, in a drawer over the list. */
function OpenedZone(props: {
  readonly cities: Cities;
  readonly zone: string;
  readonly mayChange: boolean;
  readonly onClose: () => void;
  readonly onRenamed: (name: string) => Promise<void>;
  readonly onDeleted: () => Promise<void>;
}) {
  const { cities, zone } = props;
  return (
    <FormDrawer title={zone} onClose={props.onClose}>
      <ZoneRecord
        zone={zone}
        deletable={cities.deletable_zones.includes(zone)}
        mayChange={props.mayChange}
        onRenamed={props.onRenamed}
        onDeleted={props.onDeleted}
      />
    </FormDrawer>
  );
}

/** The way to add a zone, a form in a drawer. */
function AddZone({ onAdded }: { readonly onAdded: () => Promise<void> }) {
  return (
    <DrawerButton icon={ACTION_ICONS.plus} label={copy.add}>
      {(close) => (
        <ZoneForm
          onAdded={async () => {
            close();
            await onAdded();
          }}
          onCancel={close}
        />
      )}
    </DrawerButton>
  );
}

interface ZoneRow {
  readonly zone: string;
  readonly cities: string;
}

const COLUMNS: readonly Column<ZoneRow>[] = [
  { label: copy.columns.zone, sort: (row) => row.zone },
  { label: copy.columns.cities, sort: (row) => row.cities },
];

/** Each zone, with the cities in it. */
export function Zones({ cities, reread }: { cities: Cities; reread: () => Promise<void> }) {
  const access = useAccess();
  const [said, setSaid] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const mayChange = access.mayCall("PATCH /api/zones/{name}");
  const rows = cities.zones.map((zone) => ({
    zone,
    cities:
      cities.cities
        .filter((city) => city.zone === zone)
        .map((city) => city.name)
        .join(", ") || copy.noCities,
  }));
  const view = useTableView(rows, COLUMNS);
  return (
    <Panel
      titleId="zones"
      title={copy.panel}
      count={cities.zones.length}
      actions={
        access.mayCall("POST /api/zones") && (
          <AddZone
            onAdded={async () => {
              setSaid(copy.added);
              await reread();
            }}
          />
        )
      }
    >
      <Table>
        <thead>
          <tr>
            <SortHeads view={view} />
          </tr>
        </thead>
        <tbody>
          {view.shown.map((row) => (
            <tr key={row.zone}>
              <RowHead>
                <RowOpener
                  onOpen={() => {
                    setSaid(null);
                    setOpened(row.zone);
                  }}
                >
                  {row.zone}
                </RowOpener>
              </RowHead>
              <td>{row.cities}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <TableEnd view={view} />
      {said !== null && <Toast>{said}</Toast>}
      {opened !== null && cities.zones.includes(opened) && (
        <OpenedZone
          cities={cities}
          zone={opened}
          mayChange={mayChange}
          onClose={() => {
            setOpened(null);
          }}
          onRenamed={async (name) => {
            await reread();
            setOpened(name);
          }}
          onDeleted={async () => {
            setOpened(null);
            setSaid(copy.deleted);
            await reread();
          }}
        />
      )}
    </Panel>
  );
}
