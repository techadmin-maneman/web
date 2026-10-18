// The prices a city sets apart from the book's: each from its day, before the national price there. One still to come
// may be withdrawn, asked once in its row; the one in force and the spent ones stay, as an invoice may stand on them.

import { EmptyState } from "@maneman/ui/EmptyState";
import { Panel } from "@maneman/ui/Panel";
import { DrawerButton } from "../components/DrawerButton.tsx";
import { Table } from "@maneman/ui/Table";
import { DateInput, Field, NumberInput, Select, TextInput } from "@maneman/ui/Field";
import { InlineMessage } from "@maneman/ui/InlineMessage";
import { rupees } from "@maneman/web-kit/money";
import { errorText } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { AddForm } from "../components/AddForm.tsx";
import { DeleteAction } from "../components/DeleteAction.tsx";
import { cities } from "../content/cities.ts";
import { useAccess } from "../lib/access.ts";
import form from "../components/forms.module.css";
import type { Cities, CityPrice } from "./types.ts";
import { RowHead } from "../components/RowHead.tsx";
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
        warning: (city: string) => copy.withdrawing.warning(item, city, price.valid_from),
      }}
      send={() => citiesApi.removePrice(price.city, price.item, price.tier, price.valid_from)}
      refusal={(code) => errorText(copy.errors, { code })}
      onDeleted={onDone}
    />
  );
}

function PriceTable({ cities, onDone }: { cities: Cities; onDone: () => Promise<void> }) {
  const mayWithdraw = useAccess().mayCall("DELETE /api/cities/{name}/prices/{item}/{tier}/{valid_from}");
  if (cities.prices.length === 0) return <EmptyState look="panel" line={copy.none} />;
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
        {cities.prices.map((price) => (
          <tr key={`${price.city}/${price.item}/${price.tier}/${price.valid_from}`}>
            <RowHead>{price.city}</RowHead>
            <td>
              {copy.items[price.item]} · {price.tier}
            </td>
            <td>{rupees(price.amount_ex_gst)}</td>
            <td>{price.gst_percent}%</td>
            <td>{price.in_force ? copy.inForce : price.valid_from}</td>
            <td>{mayWithdraw && price.valid_from > cities.today && <Withdraw price={price} onDone={onDone} />}</td>
          </tr>
        ))}
      </tbody>
    </Table>
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
      words={{ add: cities.form.add, cancel: copy.cancel }}
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
      {said !== null && (
        <InlineMessage tone="saved" className={form.saved}>
          {said}
        </InlineMessage>
      )}
    </Panel>
  );
}
