// Our cities: each with its state, its zone, its technicians and whether we serve it, warned where it is served with
// none. A row opens its record beside the list, where each value, and each rule the city sets for itself, changes where
// it reads (docs/decisions/0212-editing-in-place.md).

import { Toast } from "@maneman/ui/Toast";
import { PageActions } from "../frame/PageHead.tsx";
import { Panel } from "@maneman/ui/Panel";
import { FIGURE, Table } from "@maneman/ui/Table";
import { ViewRows } from "@maneman/ui/ListRow";
import { useIsPhone } from "../lib/media.ts";
import { Narrowing, SortHeads, TableEnd } from "@maneman/ui/TableTools";
import { useTableView, type Column } from "@maneman/ui/useTableView";
import { Badge } from "@maneman/ui/Badge";
import { TextButton } from "@maneman/ui/TextLink";
import { useState } from "react";
import { DrawerButton } from "@maneman/ui/DrawerButton";
import { FormDrawer } from "@maneman/ui/FormDrawer";
import { RowHead } from "@maneman/ui/RowHead";
import { cities as words } from "../content/cities.ts";
import { useAccess } from "../lib/access.ts";
import { AddCity } from "./CityForm.tsx";
import { CityRecord } from "./CityRecord.tsx";
import type { Cities, City } from "./types.ts";

const copy = words.list;

/** A city's standing in its tone: served is done; served with nobody to send is to act on; the rest are quiet. */
function Status({ city }: { city: City }) {
  if (!city.active) return <Badge tone="neutral">{copy.hidden}</Badge>;
  if (!city.served) return <Badge tone="neutral">{copy.notServed}</Badge>;
  if (city.technicians === 0) return <Badge tone="warning">{copy.noTechnician}</Badge>;
  return <Badge tone="done">{copy.served}</Badge>;
}

/** A city's standing in words, as its badge says it: the list sorts and narrows by it. */
function standingOf(city: City): string {
  if (!city.active) return copy.hidden;
  if (!city.served) return copy.notServed;
  return city.technicians === 0 ? copy.noTechnician : copy.served;
}

const COLUMNS: readonly Column<City>[] = [
  { label: copy.columns.city, sort: (city) => city.name },
  { label: copy.columns.state, sort: (city) => city.state ?? "", choice: (city) => city.state ?? copy.noState },
  { label: copy.columns.zone, sort: (city) => city.zone ?? "", choice: (city) => city.zone ?? copy.noZone },
  { label: copy.columns.technicians, sort: (city) => city.technicians, figure: true },
  { label: copy.columns.status, sort: standingOf, choice: standingOf },
];

function CityTable({ cities, onOpen }: { cities: Cities; onOpen: (name: string) => void }) {
  const view = useTableView(cities.cities, COLUMNS, { search: (city) => `${city.name} ${city.state ?? ""}` });
  const phone = useIsPhone();
  if (phone) {
    return (
      <>
        <Narrowing view={view} label={copy.find} />
        <ViewRows
          rows={view.shown}
          label={copy.panel}
          row={(city) => ({
            key: city.name,
            title: city.name,
            meta: [city.state ?? copy.noState, city.zone ?? copy.noZone].join(" · "),
            end: standingOf(city),
            endTone: city.served && city.active && city.technicians === 0 ? "warning" : "muted",
            label: copy.open(city.name),
            onClick: () => {
              onOpen(city.name);
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
      <Table>
        <thead>
          <tr>
            <SortHeads view={view} />
          </tr>
        </thead>
        <tbody>
          {view.shown.map((city) => (
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
              <td>{city.state === null ? copy.noState : `${city.state} (${city.state_code ?? ""})`}</td>
              <td>{city.zone ?? copy.noZone}</td>
              <td className={FIGURE}>{city.technicians}</td>
              <td>
                <Status city={city} />
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <TableEnd view={view} />
    </>
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
