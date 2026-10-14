// Our cities: each with its state, its zone and whether we serve it, changed or added in the form beneath.

import { RowButton } from "@maneman/ui/Button";
import { Panel } from "@maneman/ui/Panel";
import { Table } from "@maneman/ui/Table";
import { InlineMessage } from "@maneman/ui/InlineMessage";
import { useState } from "react";
import { cities } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import styles from "../components/forms.module.css";
import type { CitiesBook, City } from "./book.ts";
import { CityForm } from "./CityForm.tsx";

const copy = cities.list;

/** What the form beneath is doing: adding a city, or changing the one named. */
type Doing = { readonly kind: "add" } | { readonly kind: "change"; readonly name: string };

const statusOf = (city: City): string => {
  if (!city.active) return copy.hidden;
  return city.served ? copy.served : copy.notServed;
};

export function CityList({ book, onSaved }: { book: CitiesBook; onSaved: () => void }) {
  const mayChange = useAccess().mayCall("PATCH /api/cities/{name}");
  const mayAdd = useAccess().mayCall("POST /api/cities");
  const [doing, setDoing] = useState<Doing>({ kind: "add" });
  const [said, setSaid] = useState<string | null>(null);
  const changing = doing.kind === "change" ? book.cities.find((city) => city.name === doing.name) : undefined;
  return (
    <Panel titleId="cities" title={copy.panel} count={book.cities.length}>
      <Table className={styles.table}>
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
          {book.cities.map((city) => (
            <tr key={city.name}>
              <th scope="row" className={styles.rowHead}>
                {city.name}
              </th>
              <td>{city.state === null ? "" : `${city.state} (${city.state_code ?? ""})`}</td>
              <td>{city.zone ?? copy.noZone}</td>
              <td>{statusOf(city)}</td>
              <td>
                {mayChange && (
                  <RowButton
                    className={styles.inline}
                    aria-label={copy.changeLabel(city.name)}
                    onClick={() => {
                      setSaid(null);
                      setDoing({ kind: "change", name: city.name });
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
        <InlineMessage tone="saved" className={styles.saved}>
          {said}
        </InlineMessage>
      )}
      {(doing.kind === "add" ? mayAdd : changing !== undefined) && (
        <CityForm
          key={doing.kind === "add" ? "add" : doing.name}
          city={changing ?? null}
          zones={book.zones}
          onSaved={(words) => {
            setSaid(words);
            setDoing({ kind: "add" });
            onSaved();
          }}
          onCancel={
            doing.kind === "add"
              ? null
              : () => {
                  setDoing({ kind: "add" });
                }
          }
        />
      )}
    </Panel>
  );
}
