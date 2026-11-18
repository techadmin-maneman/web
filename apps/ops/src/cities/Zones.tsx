// The zones that group cities, as NCR does, each with the cities in it; a grant of staff access may name one
// (docs/decisions/0109-console-departments-and-access.md). A zone is added here, and a city put in it from its row.

import { Toast } from "@maneman/ui/Toast";
import { Panel } from "@maneman/ui/Panel";
import { DrawerButton } from "@maneman/ui/DrawerButton";
import { Table } from "@maneman/ui/Table";
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
          <DrawerButton label={copy.add}>
            {(close) => (
              <ZoneForm
                onAdded={async () => {
                  close();
                  setSaid(copy.added);
                  await reread();
                }}
                onCancel={close}
              />
            )}
          </DrawerButton>
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
              <RowHead>{row.zone}</RowHead>
              <td>{row.cities}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <TableEnd view={view} />
      {said !== null && <Toast>{said}</Toast>}
    </Panel>
  );
}
