// Stock · Places (docs/decisions/0155-the-stock-place-tree.md): where stock is kept, as a tree under the warehouse,
// for national managers. A hub is added for a zone and a stockroom for a city. A place's row opens its record beside
// the tree, where its name and the place above it change where they read (docs/decisions/0212-editing-in-place.md),
// and it is closed once it is empty and nothing open is under it. A technician's kit comes with them, and is only
// moved.

import { Button } from "@maneman/ui/Button";
import { Field, Select, TextInput } from "@maneman/ui/Field";
import { Panel } from "@maneman/ui/Panel";
import { Table, TableScroll } from "@maneman/ui/Table";
import { TextButton } from "@maneman/ui/TextLink";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { errorText } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { type Stock, type StockPlaceChange } from "../api.ts";
import { AddForm } from "../components/AddForm.tsx";
import { DeleteAction } from "../components/DeleteAction.tsx";
import { DrawerButton } from "../components/DrawerButton.tsx";
import { FormDrawer } from "../components/FormDrawer.tsx";
import { ChoiceRow, ReadRow, TextRow } from "../components/RecordRows.tsx";
import { Refusal } from "../components/Refusal.tsx";
import { stockPlaces as copy } from "../content/stock-places.ts";
import form from "../components/forms.module.css";
import { placeName } from "./StockForm.tsx";
import shared from "./stock.module.css";
import styles from "./places-panel.module.css";
import { stockApi } from "./stock-api.ts";

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
  box: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}) {
  return (
    <Field label={props.label} className={form.field} box={props.box}>
      {(control) => (
        <Select
          {...control}
          width="choice"
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

function AddPlace({ stock, onAdded, onCancel }: { stock: Stock; onAdded: (stock: Stock) => void; onCancel: () => void }) {
  const [kind, setKind] = useState<"hub" | "stockroom">("stockroom");
  const [name, setName] = useState("");
  const [under, setUnder] = useState("");
  const [area, setArea] = useState("");
  const parents = parentsFor(stock, kind);
  const areas = kind === "hub" ? stock.zones : stock.cities;
  const parentId = parents.some(([id]) => id === under) ? under : (parents[0]?.[0] ?? "");
  const where = areas.includes(area) ? area : (areas[0] ?? "");
  return (
    <AddForm
      title={copy.add.title}
      words={copy.add}
      errors={copy.errors}
      boxes={["name", "parent_id", "zone", "city"]}
      send={() =>
        stockApi.addStockPlace(
          kind === "hub"
            ? { kind, name: name.trim(), parent_id: parentId, zone: where }
            : { kind, name: name.trim(), parent_id: parentId, city: where },
        )
      }
      onAdded={onAdded}
      onCancel={onCancel}
    >
      <div className={form.fields}>
        <PlaceChoice
          label={copy.add.kind}
          box="kind"
          value={kind}
          options={[
            ["stockroom", copy.kinds.stockroom],
            ["hub", copy.kinds.hub],
          ]}
          onChange={(value) => {
            setKind(value === "hub" ? "hub" : "stockroom");
          }}
        />
        <Field label={copy.add.name} className={form.field} box="name">
          {(control) => (
            <TextInput
              {...control}
              maxLength={60}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          )}
        </Field>
        <PlaceChoice label={copy.add.under} box="parent_id" value={parentId} options={parents} onChange={setUnder} />
        <PlaceChoice
          label={kind === "hub" ? copy.add.zone : copy.add.city}
          box={kind === "hub" ? "zone" : "city"}
          value={where}
          options={areas.map((each) => [each, each] as const)}
          onChange={setArea}
        />
      </div>
    </AddForm>
  );
}

/** Closing a hub or a stockroom, asked once; opening one again on one press. */
function PlaceFoot(props: { place: Place; name: string; onChanged: (stock: Stock) => void }) {
  const { place } = props;
  const [busy, once] = useOneAtATime();
  const [refused, setRefused] = useState<string | null>(null);
  if (place.kind !== "hub" && place.kind !== "stockroom") return null;
  const reopen = () =>
    once(async () => {
      setRefused(null);
      const answer = await stockApi.changeStockPlace(place.id, { active: true });
      if (!answer.ok) {
        setRefused(errorText(copy.errors, answer));
        return;
      }
      props.onChanged(answer.body);
    });
  return (
    <div className={form.recordFoot}>
      {place.active ? (
        <DeleteAction
          name={props.name}
          tone="danger"
          words={copy.closing}
          send={() => stockApi.changeStockPlace(place.id, { active: false })}
          refusal={(code) => errorText(copy.errors, { code })}
          onDeleted={props.onChanged}
        />
      ) : (
        <Button variant="outline" size="small" narrow busy={busy} onClick={() => void reopen()}>
          {copy.change.open}
        </Button>
      )}
      {refused !== null && <Refusal said={refused} />}
    </div>
  );
}

/** A place's record: its name and the place above it, each changed where it reads, and what kind it is and where. */
function PlaceRecord(props: { stock: Stock; place: Place; onChanged: (stock: Stock) => void }) {
  const { stock, place } = props;
  const save = async (change: StockPlaceChange) => {
    const answer = await stockApi.changeStockPlace(place.id, change);
    if (!answer.ok) return errorText(copy.errors, answer);
    props.onChanged(answer.body);
    return null;
  };
  return (
    <>
      <div className={form.record}>
        {place.kind !== "kit" && (
          <TextRow
            label={copy.change.name}
            value={place.name}
            maxLength={60}
            mayChange
            save={(typed) => save({ name: typed.trim() })}
          />
        )}
        {place.kind !== "warehouse" && (
          <ChoiceRow
            label={copy.change.under}
            value={place.parent_id ?? ""}
            choices={parentsFor(stock, place.kind, place.id)}
            mayChange
            save={(parent) => save({ parent_id: parent })}
          />
        )}
        <ReadRow label={copy.columns[1] ?? ""} value={copy.kinds[place.kind]} />
        <ReadRow label={copy.columns[2] ?? ""} value={(place.kind === "hub" ? place.zone : place.city) ?? ""} />
      </div>
      <PlaceFoot place={place} name={placeName(stock, place.id)} onChanged={props.onChanged} />
    </>
  );
}

function PlaceRows({ stock, onOpen }: { stock: Stock; onOpen: (id: string) => void }) {
  return (
    <Table>
      <thead>
        <tr>
          {copy.columns.map((column) => (
            <th scope="col" key={column}>
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {treeOf(stock.places).map(({ place, depth }) => (
          <tr key={place.id}>
            <th scope="row" className={`${form.rowHead} ${INDENT[Math.min(depth, 3)] ?? ""}`}>
              <TextButton
                compact
                aria-label={copy.open(placeName(stock, place.id))}
                onClick={() => {
                  onOpen(place.id);
                }}
              >
                {placeName(stock, place.id)}
              </TextButton>
            </th>
            <td>
              {copy.kinds[place.kind]}
              {!place.active && place.kind !== "kit" && <span className={shared.retired}>{copy.closed}</span>}
            </td>
            <td>{place.kind === "hub" ? place.zone : place.city}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function PlacesPanel({ stock, onChanged }: { stock: Stock; onChanged: (stock: Stock) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const place = stock.places.find((each) => each.id === open);
  return (
    <Panel
      titleId="stock-places"
      title={copy.title}
      actions={
        <DrawerButton label={copy.add.title}>
          {(close) => (
            <AddPlace
              stock={stock}
              onAdded={(next) => {
                onChanged(next);
                close();
              }}
              onCancel={close}
            />
          )}
        </DrawerButton>
      }
    >
      <TableScroll labelledBy="stock-places">
        <PlaceRows stock={stock} onOpen={setOpen} />
      </TableScroll>
      {place !== undefined && (
        <FormDrawer
          title={placeName(stock, place.id)}
          onClose={() => {
            setOpen(null);
          }}
        >
          <PlaceRecord stock={stock} place={place} onChanged={onChanged} />
        </FormDrawer>
      )}
    </Panel>
  );
}
