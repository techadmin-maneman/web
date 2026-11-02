// The prices a city sets apart from the book's: each from its day, before the national price there. One still to come
// may be withdrawn, asked once in its row; the one in force and the spent ones stay, as an invoice may stand on them.

import { Toast } from "@maneman/ui/Toast";
import { plainDate } from "@maneman/web-kit/plain-date";
import { EmptyState } from "@maneman/ui/EmptyState";
import { Panel } from "@maneman/ui/Panel";
import { DrawerButton } from "@maneman/ui/DrawerButton";
import { ACTIONS, FIGURE, Table } from "@maneman/ui/Table";
import { Narrowing, SortHeads, TableEnd } from "@maneman/ui/TableTools";
import { useTableView, type Column } from "@maneman/ui/useTableView";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { DateInput, Field, NumberInput, Select, TextInput } from "@maneman/ui/Field";
import { rupees } from "@maneman/web-kit/money";
import { errorText } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { AddForm } from "@maneman/ui/AddForm";
import { DeleteAction } from "@maneman/ui/DeleteAction";
import { cities } from "../content/cities.ts";
import { useAccess } from "../lib/access.ts";
import form from "@maneman/ui/forms.module.css";
import type { Cities, CityPrice } from "./types.ts";
import { RowHead } from "@maneman/ui/RowHead";
import { citiesApi } from "./cities-api.ts";

const copy = cities.prices;
type Item = CityPrice["item"];
// A first fit is priced by its hair system and its service visit, so a city prices those instead.
const ITEMS = (Object.keys(copy.items) as Item[]).filter((item) => item !== "first_fit");

function Withdraw({ price, onDone }: { price: CityPrice; onDone: () => Promise<void> }) {
  const item = copy.items[price.item];
  return (
    <DeleteAction
      name={price.city}
      words={{
        ...copy.withdrawing,
        label: (city: string) => copy.withdrawing.label(item, city),
        warning: (city: string) => copy.withdrawing.warning(item, city, plainDate(price.valid_from)),
      }}
      send={() => citiesApi.removePrice(price.city, price.item, price.tier, price.valid_from)}
      refusal={(code) => errorText(copy.errors, { code })}
      onDeleted={onDone}
    />
  );
}

const serviceOf = (price: CityPrice) => `${copy.items[price.item]} · ${price.tier}`;

/** Each column sorts; a city and a service each narrow the list. */
const COLUMNS: readonly Column<CityPrice>[] = [
  { label: copy.columns.city, sort: (price) => price.city, choice: (price) => price.city },
  { label: copy.columns.service, sort: serviceOf, choice: (price) => copy.items[price.item] },
  { label: copy.columns.before, sort: (price) => price.amount_ex_gst, figure: true },
  { label: copy.columns.gst, sort: (price) => price.gst_percent, figure: true },
  { label: copy.columns.from, sort: (price) => price.valid_from },
];

function PriceTable({ cities, onDone }: { cities: Cities; onDone: () => Promise<void> }) {
  const mayWithdraw = useAccess().mayCall("DELETE /api/cities/{name}/prices/{item}/{tier}/{valid_from}");
  const view = useTableView(cities.prices, COLUMNS, { search: (price) => `${price.city} ${serviceOf(price)}` });
  if (cities.prices.length === 0) return <EmptyState look="panel" line={copy.none} />;
  return (
    <>
      <Narrowing view={view} label={copy.find} />
      <Table>
        <thead>
          <tr>
            <SortHeads view={view} />
            <th scope="col">
              <VisuallyHidden>{copy.columns.withdraw}</VisuallyHidden>
            </th>
          </tr>
        </thead>
        <tbody>
          {view.shown.map((price) => (
            <tr key={`${price.city}/${price.item}/${price.tier}/${price.valid_from}`}>
              <RowHead>{price.city}</RowHead>
              <td>{serviceOf(price)}</td>
              <td className={FIGURE}>{rupees(price.amount_ex_gst)}</td>
              <td className={FIGURE}>{price.gst_percent}%</td>
              <td>{price.in_force ? copy.inForce : plainDate(price.valid_from)}</td>
              <td className={ACTIONS}>
                {mayWithdraw && price.valid_from > cities.today && <Withdraw price={price} onDone={onDone} />}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <TableEnd view={view} />
    </>
  );
}

interface Draft {
  readonly city: string;
  readonly item: Item;
  readonly tier: string;
  readonly amount: string;
  readonly gst: string;
  readonly from: string;
}

function PriceBoxes({ cities, draft, edit }: { cities: Cities; draft: Draft; edit: (change: Partial<Draft>) => void }) {
  return (
    <div className={form.fields}>
      <Field label={copy.city} className={form.field}>
        {(control) => (
          <Select
            {...control}
            value={draft.city}
            onChange={(event) => {
              edit({ city: event.target.value });
            }}
          >
            {cities.cities.map((city) => (
              <option key={city.name} value={city.name}>
                {city.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={copy.item} className={form.field} box="item">
        {(control) => (
          <Select
            {...control}
            value={draft.item}
            onChange={(event) => {
              edit({ item: event.target.value as Item });
            }}
          >
            {ITEMS.map((item) => (
              <option key={item} value={item}>
                {copy.items[item]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <PriceFigures draft={draft} edit={edit} />
    </div>
  );
}

/** What the price is: its tier, its figures and its day. */
function PriceFigures({ draft, edit }: { draft: Draft; edit: (change: Partial<Draft>) => void }) {
  return (
    <>
      <Field label={copy.tier} className={form.field} box="tier">
        {(control) => (
          <TextInput
            {...control}
            width="figure"
            value={draft.tier}
            onChange={(event) => {
              edit({ tier: event.target.value });
            }}
          />
        )}
      </Field>
      <Field label={copy.amount} className={form.field} box="amount_ex_gst">
        {(control) => (
          <NumberInput
            {...control}
            width="amount"
            value={draft.amount}
            onChange={(event) => {
              edit({ amount: event.target.value });
            }}
          />
        )}
      </Field>
      <Field label={copy.gst} className={form.field} box="gst_percent">
        {(control) => (
          <NumberInput
            {...control}
            width="figure"
            value={draft.gst}
            onChange={(event) => {
              edit({ gst: event.target.value });
            }}
          />
        )}
      </Field>
      <Field label={copy.from} className={form.field} box="valid_from">
        {(control) => (
          <DateInput
            {...control}
            value={draft.from}
            onChange={(event) => {
              edit({ from: event.target.value });
            }}
          />
        )}
      </Field>
    </>
  );
}

function PriceForm(props: { cities: Cities; onAdded: () => Promise<void>; onCancel: () => void }) {
  const [draft, setDraft] = useState<Draft>({
    city: props.cities.cities[0]?.name ?? "",
    item: "service",
    tier: "standard",
    amount: "",
    gst: "18",
    from: "",
  });
  return (
    <AddForm
      title={copy.add}
      words={{ add: cities.form.add }}
      errors={copy.errors}
      boxes={["item", "tier", "amount_ex_gst", "gst_percent", "valid_from"]}
      send={() =>
        citiesApi.addPrice(draft.city, {
          item: draft.item,
          tier: draft.tier.trim(),
          amount_ex_gst: Number(draft.amount) * 100,
          gst_percent: Number(draft.gst),
          valid_from: draft.from,
        })
      }
      onAdded={props.onAdded}
      onCancel={props.onCancel}
    >
      <PriceBoxes
        cities={props.cities}
        draft={draft}
        edit={(change) => {
          setDraft({ ...draft, ...change });
        }}
      />
    </AddForm>
  );
}

export function CityPrices({ cities, reread }: { cities: Cities; reread: () => Promise<void> }) {
  const mayAdd = useAccess().mayCall("POST /api/cities/{name}/prices");
  const [said, setSaid] = useState<string | null>(null);
  const saved = (words: string) => async () => {
    setSaid(words);
    await reread();
  };
  return (
    <Panel
      titleId="city-prices"
      title={copy.panel}
      count={cities.prices.length}
      actions={
        mayAdd && (
          <DrawerButton label={copy.add}>
            {(close) => (
              <PriceForm
                cities={cities}
                onAdded={async () => {
                  close();
                  await saved(copy.added)();
                }}
                onCancel={close}
              />
            )}
          </DrawerButton>
        )
      }
    >
      <PriceTable cities={cities} onDone={saved(copy.withdrawn)} />
      {said !== null && <Toast>{said}</Toast>}
    </Panel>
  );
}
