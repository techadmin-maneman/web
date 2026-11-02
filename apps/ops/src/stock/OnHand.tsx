// Stock · On hand (docs/decisions/0159-stock-views-and-expiry.md): what a place holds of each item. One place at a
// time, as it is picked: its figure, marked when it is low or out, the soonest of its lots to expire and when it was
// last counted, each in a column of its own. With a handful of places, every place side by side as well.

import { Badge } from "@maneman/ui/Badge";
import { ListRow, ListRows } from "@maneman/ui/ListRow";
import { SearchInput } from "@maneman/ui/SearchInput";
import { ToggleButton } from "@maneman/ui/ToggleButton";
import { Toolbar } from "@maneman/ui/Toolbar";
import { ChoiceOptions, Field, Select } from "@maneman/ui/Field";
import { EmptyState } from "@maneman/ui/EmptyState";
import { Note } from "@maneman/ui/Note";
import { RowHead } from "@maneman/ui/RowHead";
import { FIGURE, Table, TableScroll, type RuleTone } from "@maneman/ui/Table";
import { addDays, indiaDate, listDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { type Stock } from "../api.ts";
import { OpsLink } from "../frame/Shell.tsx";
import { shell } from "../content/shell.ts";
import { stock as copy } from "../content/stock.ts";
import form from "@maneman/ui/forms.module.css";
import { placeChoices, placeName } from "./StockForm.tsx";
import { holdingOf, unitOf } from "./holdings.ts";
import { StateBadge, stateOf, type Consumable, type State } from "./stock-state.tsx";
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

/** What a place holds of an item, its state beneath: every place side by side has no room for a column of states. */
function Held({ stock, consumable, place }: { stock: Stock; consumable: Consumable; place: string }) {
  const holding = holdingOf(stock, consumable.code, place);
  const state = stateOf(stock, consumable, place);
  return (
    <td className={styles.held}>
      {copy.held(holding?.quantity ?? 0, unitOf(stock, consumable.code))}
      {state !== null && (
        <span className={styles.state}>
          <StateBadge state={state} />
        </span>
      )}
    </td>
  );
}

export interface PlaceNeeds {
  readonly place: Stock["places"][number];
  readonly below: number;
  readonly out: number;
  readonly low: number;
}

/** The places with something below zero, out or low, the worst first, and how many items each; Today counts them too. */
export function placesNeedingAttention(stock: Stock): PlaceNeeds[] {
  return stock.places
    .map((place) => {
      const needs = stock.consumables.map((consumable) => stateOf(stock, consumable, place.id)?.need);
      const count = (need: State["need"]) => needs.filter((each) => each === need).length;
      return { place, below: count("below"), out: count("out"), low: count("low") };
    })
    .filter((row) => row.below + row.out + row.low > 0)
    .sort((one, other) => other.below - one.below || other.out - one.out || other.low - one.low);
}

/** A place's rule: below zero in the error's red, out in the warning's, low in brass. */
const ruleOf = (row: PlaceNeeds): RuleTone => {
  if (row.below > 0) return "error";
  return row.out > 0 ? "warning" : "attention";
};

/** The places with something below zero, out or low, the worst first, a card each: pressing one shows its stock. A
 * card is the button, its name saying whose stock it shows. */
export function Attention({ stock, onShow }: { stock: Stock; onShow: (showing: Showing) => void }) {
  const rows = placesNeedingAttention(stock);
  if (rows.length === 0) return null;
  return (
    <ListRows label={copy.attention.title} className={styles.attentionCards}>
      {rows.map((row) => (
        <ListRow
          key={row.place.id}
          title={placeName(stock, row.place.id)}
          meta={copy.attention.counts(row.below, row.out, row.low)}
          rule={ruleOf(row)}
          onClick={() => {
            onShow({ by: "place", place: row.place.id });
            document.getElementById("stock-on-hand")?.scrollIntoView({ block: "start" });
          }}
        />
      ))}
    </ListRows>
  );
}

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
type Narrowing = "all" | "short" | "expiring";

/** Whether the item's soonest lot at the place expires within the warning's days, or has. */
function expiringSoon(stock: Stock, holding: Holding | undefined): boolean {
  const soonest = holding?.lots.find((lot) => lot.expires_on !== null)?.expires_on ?? null;
  return soonest !== null && soonest <= addDays(stock.today, stock.expiry_warning_days);
}

/** The place's items narrowed one way: every one, those low or out (or below zero), or those expiring soon. */
function narrowed(stock: Stock, place: string, narrowing: Narrowing): Consumable[] {
  if (narrowing === "all") return [...stock.consumables];
  if (narrowing === "short") return stock.consumables.filter((each) => stateOf(stock, each, place) !== null);
  return stock.consumables.filter((each) => expiringSoon(stock, holdingOf(stock, each.code, place)));
}

/** The chips that narrow a place's items, each with how many it holds, and the box that finds one by name. */
function NarrowItems(props: {
  stock: Stock;
  place: string;
  narrowing: Narrowing;
  onNarrow: (narrowing: Narrowing) => void;
  found: string;
  onFind: (found: string) => void;
}) {
  const { stock, place } = props;
  return (
    <Toolbar label={copy.narrow.label} className={styles.narrow}>
      <SearchInput label={copy.narrow.find} value={props.found} maxLength={60} onChange={props.onFind} />
      <div role="radiogroup" aria-label={copy.narrow.label} className={styles.narrowChips}>
        {(["all", "short", "expiring"] as const).map((each) => (
          <ToggleButton
            key={each}
            asRadio
            filled
            pressed={props.narrowing === each}
            count={narrowed(stock, place, each).length}
            onClick={() => {
              props.onNarrow(each);
            }}
          >
            {copy.narrow[each]}
          </ToggleButton>
        ))}
      </div>
    </Toolbar>
  );
}

function OnePlace({ stock, place }: { stock: Stock; place: string }) {
  const year = Number(stock.today.slice(0, 4));
  const [narrowing, setNarrowing] = useState<Narrowing>("all");
  const [found, setFound] = useState("");
  const shown = narrowed(stock, place, narrowing).filter((each) =>
    each.name.toLowerCase().includes(found.trim().toLowerCase()),
  );
  return (
    <>
      <NarrowItems
        stock={stock}
        place={place}
        narrowing={narrowing}
        onNarrow={setNarrowing}
        found={found}
        onFind={setFound}
      />
      {shown.length === 0 ? (
        <EmptyState look="panel" line={copy.narrow.none} />
      ) : (
        <PlaceTable stock={stock} place={place} shown={shown} year={year} />
      )}
    </>
  );
}

function PlaceTable({ stock, place, shown, year }: { stock: Stock; place: string; shown: Consumable[]; year: number }) {
  return (
    <Table controls fixed className={styles.onePlace}>
      <thead>
        <tr>
          <th scope="col">{copy.consumable}</th>
          <th scope="col" className={FIGURE}>
            {copy.columns.held}
          </th>
          <th scope="col">{copy.columns.status}</th>
          <th scope="col">{copy.columns.expires}</th>
          <th scope="col">{copy.columns.counted}</th>
        </tr>
      </thead>
      <tbody>
        {shown.map((consumable) => {
          const holding = holdingOf(stock, consumable.code, place);
          const counted = holding?.counted_at ?? null;
          return (
            <tr key={consumable.code}>
              <ItemName consumable={consumable} />
              <td className={FIGURE}>{copy.held(holding?.quantity ?? 0, unitOf(stock, consumable.code))}</td>
              <td>
                <StateBadge state={stateOf(stock, consumable, place)} />
              </td>
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
              <Held key={place.id} stock={stock} consumable={consumable} place={place.id} />
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
