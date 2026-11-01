// Stock · On hand (docs/decisions/0159-stock-views-and-expiry.md): what a place holds of each item. One place at a
// time, as it is picked: its figure, marked when it is low or out, the soonest of its lots to expire and when it was
// last counted, each in a column of its own. With a handful of places, every place side by side as well.

import { Badge, type BadgeTone } from "@maneman/ui/Badge";
import { TextButton } from "@maneman/ui/TextLink";
import { ChoiceOptions, Field, Select } from "@maneman/ui/Field";
import { Note } from "@maneman/ui/Note";
import { RowHead } from "@maneman/ui/RowHead";
import { Table, TableScroll } from "@maneman/ui/Table";
import { addDays, indiaDate, listDate } from "@maneman/web-kit/dates";
import { type Stock } from "../api.ts";
import { OpsLink } from "../frame/Shell.tsx";
import { shell } from "../content/shell.ts";
import { stock as copy } from "../content/stock.ts";
import form from "@maneman/ui/forms.module.css";
import { placeChoices, placeName } from "./StockForm.tsx";
import { holdingOf, unitOf } from "./holdings.ts";
import styles from "./stock.module.css";

/** Past this many places, every place side by side grows too wide to read: one place at a time, then. */
const SIDE_BY_SIDE = 6;

/** What the table shows: one place, every place side by side (`place` null), or totals by zone or city. */
export type Showing = { readonly by: "place"; readonly place: string | null } | { readonly by: "zone" | "city" };

const fewPlaces = (stock: Stock) => stock.places.length <= SIDE_BY_SIDE;

/** Every place side by side where there are few; else the warehouse, where the stock comes in. */
export function firstShowing(stock: Stock): Showing {
  if (fewPlaces(stock)) return { by: "place", place: null };
  const warehouse = stock.places.find((place) => place.kind === "warehouse") ?? stock.places[0];
  return { by: "place", place: warehouse?.id ?? null };
}

/** The places holding less than nothing of something, and those low or out of something. */
function needing(stock: Stock): { readonly below: readonly string[]; readonly low: readonly string[] } {
  const held = (id: string) => stock.holdings.filter((holding) => holding.place_id === id);
  const below = stock.places.filter((place) => held(place.id).some((holding) => holding.quantity < 0));
  const low = stock.places.filter((place) => !below.includes(place) && held(place.id).some((holding) => holding.low));
  return { below: below.map((place) => place.id), low: low.map((place) => place.id) };
}

/** Above the table, the places to look at, by name, each a way to show it: never a mark added to a place's name. */
export function Needs({ stock, onShow }: { stock: Stock; onShow: (showing: Showing) => void }) {
  const { below, low } = needing(stock);
  const line = (words: string, ids: readonly string[]) =>
    ids.length === 0 ? null : (
      <Note>
        {words}{" "}
        {ids.map((id, index) => (
          <span key={id}>
            {index > 0 && ", "}
            <TextButton
              inline
              onClick={() => {
                onShow({ by: "place", place: id });
              }}
            >
              {placeName(stock, id)}
            </TextButton>
          </span>
        ))}
      </Note>
    );
  return (
    <>
      {line(copy.needs.below, below)}
      {line(copy.needs.low, low)}
    </>
  );
}

/** The one control over the table: which place it shows, or how it adds its places up. */
export function Grouping(props: { stock: Stock; showing: Showing; onShow: (showing: Showing) => void }) {
  const { stock, showing } = props;
  const value = showing.by === "place" ? `place:${showing.place ?? ""}` : showing.by;
  return (
    <Field label={copy.totalsBy} labelHidden>
      {(control) => (
        <Select
          {...control}
          width="choice"
          value={value}
          onChange={(event) => {
            const picked = event.target.value;
            if (picked === "zone" || picked === "city") props.onShow({ by: picked });
            else props.onShow({ by: "place", place: picked.slice("place:".length) || null });
          }}
        >
          {fewPlaces(stock) && <option value="place:">{copy.allPlaces}</option>}
          <ChoiceOptions
            choices={placeChoices(stock).map(([id, name, group]) => [`place:${id}`, name, group] as const)}
          />
          <option value="zone">{copy.byZone}</option>
          <option value="city">{copy.byCity}</option>
        </Select>
      )}
    </Field>
  );
}

type Holding = Stock["holdings"][number];

/** Low, out, or below nought, which says a movement went unrecorded: in words, never by colour alone. */
function stateOf(holding: Holding | undefined): { readonly tone: BadgeTone; readonly word: string } | null {
  const quantity = holding?.quantity ?? 0;
  if (quantity < 0) return { tone: "error", word: copy.belowZero };
  if (holding?.low !== true) return null;
  return quantity === 0 ? { tone: "error", word: copy.out } : { tone: "warning", word: copy.low };
}

/** What a place holds of an item, and its state beside it. */
function Held({ stock, code, place }: { stock: Stock; code: string; place: string }) {
  const holding = holdingOf(stock, code, place);
  const state = stateOf(holding);
  return (
    <td className={styles.held}>
      {copy.held(holding?.quantity ?? 0, unitOf(stock, code))}
      {state !== null && (
        <Badge tone={state.tone} className={styles.state}>
          {state.word}
        </Badge>
      )}
    </td>
  );
}

/** The soonest of a place's lots to expire, dated plainly, and marked when it has or soon will. */
function Expires({ stock, holding }: { stock: Stock; holding: Holding | undefined }) {
  // The lots come soonest to expire first.
  const soonest = holding?.lots.find((lot) => lot.expires_on !== null)?.expires_on ?? null;
  if (soonest === null) return <td>{copy.noExpiry}</td>;
  const year = Number(stock.today.slice(0, 4));
  const soon = soonest <= addDays(stock.today, stock.expiry_warning_days);
  return (
    <td>
      {listDate(soonest, year)}
      {soonest < stock.today && (
        <Badge tone="error" className={styles.state}>
          {copy.expired}
        </Badge>
      )}
      {soonest >= stock.today && soon && (
        <Badge tone="warning" className={styles.state}>
          {copy.expiresSoon}
        </Badge>
      )}
    </td>
  );
}

/** Items, where each consumable and its low level is set. The sentence before it ends with it. */
function ToItems() {
  return (
    <>
      <OpsLink className={form.link} to="/items">
        {shell.sections.items}
      </OpsLink>
      .
    </>
  );
}

function ItemName({ consumable }: { consumable: Stock["consumables"][number] }) {
  return (
    <RowHead>
      {consumable.name}
      {consumable.retired && <span className={styles.retired}>{copy.retired}</span>}
    </RowHead>
  );
}

/** One place: each item's figure, its soonest expiry and when it was last counted. */
function OnePlace({ stock, place }: { stock: Stock; place: string }) {
  const year = Number(stock.today.slice(0, 4));
  return (
    <Table controls>
      <thead>
        <tr>
          <th scope="col">{copy.consumable}</th>
          <th scope="col">{copy.columns.held}</th>
          <th scope="col">{copy.columns.expires}</th>
          <th scope="col">{copy.columns.counted}</th>
        </tr>
      </thead>
      <tbody>
        {stock.consumables.map((consumable) => {
          const holding = holdingOf(stock, consumable.code, place);
          const counted = holding?.counted_at ?? null;
          return (
            <tr key={consumable.code}>
              <ItemName consumable={consumable} />
              <Held stock={stock} code={consumable.code} place={place} />
              <Expires stock={stock} holding={holding} />
              <td>{counted === null ? copy.neverCounted : listDate(indiaDate(counted), year)}</td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

/** Every place side by side: each item's figure there. */
function EveryPlace({ stock }: { stock: Stock }) {
  return (
    <Table controls>
      <thead>
        <tr>
          <th scope="col">{copy.consumable}</th>
          {stock.places.map((place) => (
            <th scope="col" key={place.id}>
              {placeName(stock, place.id)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {stock.consumables.map((consumable) => (
          <tr key={consumable.code}>
            <ItemName consumable={consumable} />
            {stock.places.map((place) => (
              <Held key={place.id} stock={stock} code={consumable.code} place={place.id} />
            ))}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function OnHand({ stock, place }: { stock: Stock; place: string | null }) {
  if (stock.consumables.length === 0) {
    return (
      <Note>
        {copy.none} <ToItems />
      </Note>
    );
  }
  return (
    <TableScroll labelledBy="stock-on-hand">
      {place === null ? <EveryPlace stock={stock} /> : <OnePlace stock={stock} place={place} />}
    </TableScroll>
  );
}
