// Our cities: each with its state, its zone, its technicians and whether we serve it, warned where it is served with
// none. A row opens its record beside the list, where each value, and each rule the city sets for itself, changes where
// it reads (docs/decisions/0212-editing-in-place.md).

import { Toast } from "@maneman/ui/Toast";
import { PageActions } from "../components/PageHead.tsx";
import { Panel } from "@maneman/ui/Panel";
import { Table } from "@maneman/ui/Table";
import { Badge } from "@maneman/ui/Badge";
import form from "../components/forms.module.css";
import { TextButton } from "@maneman/ui/TextLink";
import { useState } from "react";
import { DrawerButton } from "../components/DrawerButton.tsx";
import { FormDrawer } from "../components/FormDrawer.tsx";
import { RowHead } from "../components/RowHead.tsx";
import { cities as words } from "../content/cities.ts";
import { useAccess } from "../lib/access.ts";
import { AddCity } from "./CityForm.tsx";
import { CityRecord } from "./CityRecord.tsx";
import type { Cities, City } from "./types.ts";

const copy = words.list;

const statusOf = (city: City): string => {
  if (!city.active) return copy.hidden;
  return city.served ? copy.served : copy.notServed;
};

function CityTable({ cities, onOpen }: { cities: Cities; onOpen: (name: string) => void }) {
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
        {cities.cities.map((city) => (
          <tr key={city.name}>
            <RowHead>
              <TextButton
                compact
                aria-label={copy.open(city.name)}
                onClick={() => {
                  onOpen(city.name);
                }}
              >
                {city.name}
              </TextButton>
            </RowHead>
            <td>{city.state === null ? "" : `${city.state} (${city.state_code ?? ""})`}</td>
            <td>{city.zone ?? copy.noZone}</td>
            <td className={form.figure}>{city.technicians}</td>
            <td>
              {city.active && city.served && city.technicians === 0 ? (
                <Badge tone="attention">{copy.noTechnician}</Badge>
              ) : (
                statusOf(city)
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function CityList({ cities, reread }: { cities: Cities; reread: () => Promise<void> }) {
  const mayAdd = useAccess().mayCall("POST /api/cities");
  const [open, setOpen] = useState<string | null>(null);
  /** The name a city open had before it was renamed, until the list is read again under the new one. */
  const [was, setWas] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const opened = cities.cities.find((city) => city.name === open) ?? cities.cities.find((city) => city.name === was);
  return (
    <>
      <PageActions>
        {mayAdd && (
          <DrawerButton primary label={copy.add}>
            {(close) => (
              <AddCity
                zones={cities.zones}
                onAdded={async () => {
                  setSaid(words.form.added);
                  close();
                  await reread();
                }}
                onCancel={close}
              />
            )}
          </DrawerButton>
        )}
      </PageActions>
      <Panel titleId="cities" title={copy.panel} count={cities.cities.length}>
        <CityTable
          cities={cities}
          onOpen={(name) => {
            setSaid(null);
            setWas(null);
            setOpen(name);
          }}
        />
        {said !== null && <Toast>{said}</Toast>}
        {opened !== undefined && (
          <FormDrawer
            title={opened.name}
            onClose={() => {
              setOpen(null);
              setWas(null);
            }}
          >
            <CityRecord
              city={opened}
              cities={cities}
              reread={reread}
              onRenamed={(name) => {
                setWas(opened.name);
                setOpen(name);
              }}
            />
          </FormDrawer>
        )}
      </Panel>
    </>
  );
}
