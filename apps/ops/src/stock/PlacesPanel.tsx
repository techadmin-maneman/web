// Stock · Places (docs/decisions/0155-the-stock-place-tree.md): where stock is kept, as a tree under the warehouse,
// for national managers. A hub is added for a zone and a stockroom for a city; a place is renamed, moved under
// another, or closed once it is empty and nothing open is under it. A technician's kit comes with them, and is only
// moved.

import { InlineMessage } from "@maneman/ui/InlineMessage";
import { Panel } from "@maneman/ui/Panel";
import { Button, RowButton } from "@maneman/ui/Button";
import { Field, Select, TextInput } from "@maneman/ui/Field";
import { Table } from "@maneman/ui/Table";
import { errorText, type Failure } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { api, type Stock, type StockPlaceChange } from "../api.ts";
import { stockPlaces as copy } from "../content/stock-places.ts";
import form from "../components/forms.module.css";
import { placeName } from "./StockForm.tsx";
import styles from "./stock.module.css";

type Place = Stock["places"][number];
type Kind = Place["kind"];

/** How far down the tree each kind sits: a place hangs only from an open one above it. */
const DEPTH: Readonly<Record<Kind, number>> = { warehouse: 0, hub: 1, stockroom: 2, kit: 3 };
const INDENT = [undefined, styles.depth1, styles.depth2, styles.depth3];

/** The places in tree order, each followed by those under it; any whose place above is not listed goes last. */
function treeOf(places: readonly Place[]): { place: Place; depth: number }[] {
  const rows: { place: Place; depth: number }[] = [];
  const visit = (parent: string | null, depth: number) => {
    for (const place of places.filter((each) => each.parent_id === parent)) {
      rows.push({ place, depth });
      visit(place.id, depth + 1);
    }
  };
  visit(null, 0);
  const listed = new Set(rows.map((row) => row.place.id));
  return [...rows, ...places.filter((place) => !listed.has(place.id)).map((place) => ({ place, depth: 0 }))];
}

/** The open places a place of `kind` may hang from, by name. */
const parentsFor = (stock: Stock, kind: Kind, except?: string) =>
  stock.places
    .filter((place) => place.active && DEPTH[place.kind] < DEPTH[kind] && place.id !== except)
    .map((place) => [place.id, placeName(stock, place.id)] as const);

function PlaceChoice(props: {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}) {
  return (
    <Field label={props.label} className={form.field}>
      {(control) => (
        <Select
          {...control}
          className={form.choiceBox}
          value={props.value}
          onChange={(event) => {
            props.onChange(event.target.value);
          }}
        >
          {props.options.map(([value, words]) => (
            <option key={value} value={value}>
              {words}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

function NameBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Field label={copy.add.name} className={form.field}>
      {(control) => (
        <TextInput
          {...control}
          maxLength={60}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      )}
    </Field>
  );
}

function Refusal({ failure }: { failure: Failure | null }) {
  if (failure === null) return null;
  return (
    <InlineMessage tone="error" className={form.error}>
      {errorText(copy.errors, failure)}
    </InlineMessage>
  );
}

type Answer = Awaited<ReturnType<typeof api.addStockPlace>>;

/** Sends a change, then hands the stock it answers on, or keeps the refusal to show. */
function useSending(onChanged: (stock: Stock) => void) {
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async (call: () => Promise<Answer>): Promise<boolean> => {
    setBusy(true);
    setFailure(null);
    const answer = await call();
    setBusy(false);
    if (!answer.ok) {
      setFailure({ code: answer.code, fields: answer.fields });
      return false;
    }
    onChanged(answer.body);
    return true;
  };
  return { failure, busy, send };
}

function AddPlace({ stock, onChanged }: { stock: Stock; onChanged: (stock: Stock) => void }) {
  const [kind, setKind] = useState<"hub" | "stockroom">("stockroom");
  const [name, setName] = useState("");
  const [under, setUnder] = useState("");
  const [area, setArea] = useState("");
  const { failure, busy, send } = useSending(onChanged);
  const parents = parentsFor(stock, kind);
  const areas = kind === "hub" ? stock.zones : stock.cities;
  const parentId = parents.some(([id]) => id === under) ? under : (parents[0]?.[0] ?? "");
  const where = areas.includes(area) ? area : (areas[0] ?? "");
  const add = async () => {
    const place =
      kind === "hub"
        ? { kind, name: name.trim(), parent_id: parentId, zone: where }
        : { kind, name: name.trim(), parent_id: parentId, city: where };
    if (await send(() => api.addStockPlace(place))) setName("");
  };
  return (
    <div className={form.group}>
      <h3 className={form.ruleTitle}>{copy.add.title}</h3>
      <div className={form.fields}>
        <PlaceChoice
          label={copy.add.kind}
          value={kind}
          options={[
            ["stockroom", copy.kinds.stockroom],
            ["hub", copy.kinds.hub],
          ]}
          onChange={(value) => {
            setKind(value === "hub" ? "hub" : "stockroom");
          }}
        />
        <NameBox value={name} onChange={setName} />
        <PlaceChoice label={copy.add.under} value={parentId} options={parents} onChange={setUnder} />
        <PlaceChoice
          label={kind === "hub" ? copy.add.zone : copy.add.city}
          value={where}
          options={areas.map((each) => [each, each] as const)}
          onChange={setArea}
        />
      </div>
      <div className={form.actions}>
        <Button
          variant="primary"
          size="small"
          disabled={busy || name.trim() === "" || parentId === "" || where === ""}
          onClick={() => void add()}
        >
          {copy.add.send}
        </Button>
      </div>
      <Refusal failure={failure} />
    </div>
  );
}

function ChangePlace(props: { stock: Stock; place: Place; onChanged: (stock: Stock) => void; onDone: () => void }) {
  const { stock, place } = props;
  const [name, setName] = useState(place.name);
  const [under, setUnder] = useState(place.parent_id ?? "");
  const { failure, busy, send } = useSending(props.onChanged);
  const parents = parentsFor(stock, place.kind, place.id);
  const save = async (change: StockPlaceChange) => {
    if (await send(() => api.changeStockPlace(place.id, change))) props.onDone();
  };
  const edited: StockPlaceChange = {
    ...(place.kind !== "kit" && name.trim() !== place.name ? { name: name.trim() } : {}),
    ...(place.kind !== "warehouse" && under !== place.parent_id ? { parent_id: under } : {}),
  };
  const closable = place.kind === "hub" || place.kind === "stockroom";
  return (
    <div className={form.group}>
      <h3 className={form.ruleTitle}>{copy.editLabel(placeName(stock, place.id))}</h3>
      <div className={form.fields}>
        {place.kind !== "kit" && <NameBox value={name} onChange={setName} />}
        {place.kind !== "warehouse" && (
          <PlaceChoice label={copy.change.under} value={under} options={parents} onChange={setUnder} />
        )}
      </div>
      <div className={form.actions}>
        <Button
          variant="primary"
          size="small"
          disabled={busy || Object.keys(edited).length === 0 || name.trim() === ""}
          onClick={() => void save(edited)}
        >
          {copy.change.save}
        </Button>
        {closable && (
          <Button variant="outline" size="small" disabled={busy} onClick={() => void save({ active: !place.active })}>
            {place.active ? copy.change.close : copy.change.open}
          </Button>
        )}
        <Button variant="outline" size="small" onClick={props.onDone}>
          {copy.change.cancel}
        </Button>
      </div>
      <Refusal failure={failure} />
    </div>
  );
}

function PlaceRows({ stock, onEdit }: { stock: Stock; onEdit: (id: string) => void }) {
  return (
    <Table className={form.table}>
      <thead>
        <tr>
          {copy.columns.map((column, index) => (
            <th scope="col" key={index}>
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {treeOf(stock.places).map(({ place, depth }) => (
          <tr key={place.id}>
            <th scope="row" className={`${form.rowHead} ${INDENT[Math.min(depth, 3)] ?? ""}`}>
              {placeName(stock, place.id)}
            </th>
            <td>
              {copy.kinds[place.kind]}
              {!place.active && place.kind !== "kit" && <span className={styles.retired}>{copy.closed}</span>}
            </td>
            <td>{place.kind === "hub" ? place.zone : place.city}</td>
            <td>
              <RowButton
                className={form.inline}
                aria-label={copy.editLabel(placeName(stock, place.id))}
                onClick={() => {
                  onEdit(place.id);
                }}
              >
                {copy.edit}
              </RowButton>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function PlacesPanel({ stock, onChanged }: { stock: Stock; onChanged: (stock: Stock) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const place = stock.places.find((each) => each.id === editing);
  return (
    <Panel titleId="stock-places" title={copy.title}>
      <p className={form.note}>{copy.intro}</p>
      <div className={styles.scroll}>
        <PlaceRows stock={stock} onEdit={setEditing} />
      </div>
      {place === undefined ? (
        <AddPlace stock={stock} onChanged={onChanged} />
      ) : (
        <ChangePlace
          key={place.id}
          stock={stock}
          place={place}
          onChanged={onChanged}
          onDone={() => {
            setEditing(null);
          }}
        />
      )}
    </Panel>
  );
}
