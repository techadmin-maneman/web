// Our cities: each with its state, its zone and whether we serve it, changed or added in the form beneath.

import { RowButton } from "@maneman/ui/Button";
import { Panel } from "@maneman/ui/Panel";
import { Table } from "@maneman/ui/Table";
import { InlineMessage } from "@maneman/ui/InlineMessage";
import { useState } from "react";
import { cities } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import form from "../components/forms.module.css";
import type { Cities, City } from "./types.ts";
import { CityForm } from "./CityForm.tsx";
import { RowHead } from "../components/RowHead.tsx";
import { FormDrawer } from "../components/FormDrawer.tsx";
import { DrawerButton } from "../components/DrawerButton.tsx";

const copy = cities.list;

const statusOf = (city: City): string => {
  if (!city.active) return copy.hidden;
  return city.served ? copy.served : copy.notServed;
};

/** Adding a city, from the list's head. */
function AddCity({ zones, onSaved }: { zones: readonly string[]; onSaved: (said: string) => void }) {
  return (
    <DrawerButton label={copy.add}>
      {(close) => (
        <CityForm
          city={null}
          zones={zones}
          onSaved={(words) => {
            onSaved(words);
            close();
          }}
          onCancel={close}
        />
      )}
    </DrawerButton>
  );
}

export function CityList({ cities, onSaved }: { cities: Cities; onSaved: () => void }) {
  const mayChange = useAccess().mayCall("PATCH /api/cities/{name}");
  const mayAdd = useAccess().mayCall("POST /api/cities");
  const [changingName, setChangingName] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const changing = cities.cities.find((city) => city.name === changingName);
  const saved = (words: string) => {
    setSaid(words);
    setChangingName(null);
    onSaved();
  };
  return (
    <Panel
      titleId="cities"
      title={copy.panel}
      count={cities.cities.length}
      actions={mayAdd && <AddCity zones={cities.zones} onSaved={saved} />}
    >
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
          {cities.cities.map((city) => (
            <tr key={city.name}>
              <RowHead>{city.name}</RowHead>
              <td>{city.state === null ? "" : `${city.state} (${city.state_code ?? ""})`}</td>
              <td>{city.zone ?? copy.noZone}</td>
              <td>{statusOf(city)}</td>
              <td>
                {mayChange && (
                  <RowButton
                    beside
                    aria-label={copy.changeLabel(city.name)}
                    onClick={() => {
                      setSaid(null);
                      setChangingName(city.name);
                    }}
                  >
                    {copy.change}
                  </RowButton>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      {said !== null && (
        <InlineMessage tone="saved" className={form.saved}>
          {said}
        </InlineMessage>
      )}
      {changing !== undefined && (
        <FormDrawer
          title={changing.name}
          onClose={() => {
            setChangingName(null);
          }}
        >
          <CityForm
            key={changing.name}
            city={changing}
            zones={cities.zones}
            onSaved={saved}
            onCancel={() => {
              setChangingName(null);
            }}
          />
        </FormDrawer>
      )}
    </Panel>
  );
}
