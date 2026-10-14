// The prices a city sets apart from the book's: each from its day, before the national price there. One still to come
// may be withdrawn; the one in force and the spent ones stay, as an invoice may stand on them.

import { Panel } from "@maneman/ui/Panel";
import { Table } from "@maneman/ui/Table";
import { DateInput, Field, NumberInput, Select, TextInput } from "@maneman/ui/Field";
import { InlineMessage } from "@maneman/ui/InlineMessage";
import { rupees } from "@maneman/web-kit/money";
import { useState } from "react";
import { client } from "../api.ts";
import { cities } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { ActionCheck, SettingForm, sentOf, useSteps } from "../settings/index.ts";
import styles from "../components/forms.module.css";
import type { CitiesBook, CityPrice } from "./book.ts";

const copy = cities.prices;
type Item = CityPrice["item"];
const ITEMS = Object.keys(copy.items) as Item[];

function Withdraw({ price, onDone }: { price: CityPrice; onDone: () => void }) {
  const item = copy.items[price.item];
  return (
    <ActionCheck
      label={copy.withdraw}
      ariaLabel={copy.withdrawLabel(item, price.city)}
      question={copy.withdrawQuestion(item, price.city, price.valid_from)}
      send={async () =>
        sentOf(
          await client.delete("/api/cities/{name}/prices/{item}/{tier}/{valid_from}", {
            path: { name: price.city, item: price.item, tier: price.tier, valid_from: price.valid_from },
          }),
          () => ({}),
        )
      }
      onDone={onDone}
      errors={copy.errors}
    />
  );
}

function PriceTable({ book, onDone }: { book: CitiesBook; onDone: () => void }) {
  const mayWithdraw = useAccess().mayCall("DELETE /api/cities/{name}/prices/{item}/{tier}/{valid_from}");
  if (book.prices.length === 0) return <p className={styles.note}>{copy.none}</p>;
  return (
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
        {book.prices.map((price) => (
          <tr key={`${price.city}/${price.item}/${price.tier}/${price.valid_from}`}>
            <th scope="row" className={styles.rowHead}>
              {price.city}
            </th>
            <td>
              {copy.items[price.item]} · {price.tier}
            </td>
            <td>{rupees(price.amount_ex_gst)}</td>
            <td>{price.gst_percent}%</td>
            <td>{price.in_force ? copy.inForce : price.valid_from}</td>
            <td>{mayWithdraw && price.valid_from > book.today && <Withdraw price={price} onDone={onDone} />}</td>
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

function PriceBoxes({ book, draft, edit }: { book: CitiesBook; draft: Draft; edit: (change: Partial<Draft>) => void }) {
  return (
    <div className={styles.fields}>
      <Field label={copy.city} className={styles.field}>
        {(control) => (
          <Select {...control} value={draft.city} onChange={(event) => { edit({ city: event.target.value }); }}>
            {book.cities.map((city) => (
              <option key={city.name} value={city.name}>
                {city.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={copy.item} className={styles.field}>
        {(control) => (
          <Select {...control} value={draft.item} onChange={(event) => { edit({ item: event.target.value as Item }); }}>
            {ITEMS.map((item) => (
              <option key={item} value={item}>
                {copy.items[item]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={copy.tier} className={styles.field}>
        {(control) => (
          <TextInput
            {...control}
            className={styles.figureBox}
            value={draft.tier}
            onChange={(event) => { edit({ tier: event.target.value }); }}
          />
        )}
      </Field>
      <Field label={copy.amount} className={styles.field}>
        {(control) => (
          <NumberInput
            {...control}
            className={styles.amountBox}
            value={draft.amount}
            onChange={(event) => { edit({ amount: event.target.value }); }}
          />
        )}
      </Field>
      <Field label={copy.gst} className={styles.field}>
        {(control) => (
          <NumberInput
            {...control}
            className={styles.figureBox}
            value={draft.gst}
            onChange={(event) => { edit({ gst: event.target.value }); }}
          />
        )}
      </Field>
      <Field label={copy.from} className={styles.field}>
        {(control) => (
          <DateInput {...control} value={draft.from} onChange={(event) => { edit({ from: event.target.value }); }} />
        )}
      </Field>
    </div>
  );
}

function PriceForm({ book, onSaved }: { book: CitiesBook; onSaved: () => void }) {
  const first: Draft = {
    city: book.cities[0]?.name ?? "",
    item: "service",
    tier: "standard",
    amount: "",
    gst: "18",
    from: "",
  };
  const [draft, setDraft] = useState<Draft>(first);
  const steps = useSteps(
    async () =>
      sentOf(
        await client.post("/api/cities/{name}/prices", {
          path: { name: draft.city },
          body: {
            item: draft.item,
            tier: draft.tier.trim(),
            amount_ex_gst: Number(draft.amount) * 100,
            gst_percent: Number(draft.gst),
            valid_from: draft.from,
          },
        }),
        () => ({}),
      ),
    () => {
      setDraft(first);
      onSaved();
    },
  );
  const edit = (change: Partial<Draft>) => {
    setDraft({ ...draft, ...change });
    steps.edit();
  };
  const ready = /^\d{1,7}$/.test(draft.amount.trim()) && /^\d{1,2}$/.test(draft.gst.trim()) && draft.from !== "";
  const line = copy.adding(draft.city, copy.items[draft.item], rupees(Number(draft.amount) * 100), draft.from);
  return (
    <SettingForm
      title={copy.add}
      steps={steps}
      ready={ready}
      errors={copy.errors}
      onCancel={null}
      checking={<p className={styles.checkLine}>{line}</p>}
    >
      <PriceBoxes book={book} draft={draft} edit={edit} />
    </SettingForm>
  );
}

export function CityPrices({ book, onSaved }: { book: CitiesBook; onSaved: () => void }) {
  const mayAdd = useAccess().mayCall("POST /api/cities/{name}/prices");
  const [said, setSaid] = useState<string | null>(null);
  const saved = (words: string) => () => {
    setSaid(words);
    onSaved();
  };
  return (
    <Panel titleId="city-prices" title={copy.panel} count={book.prices.length}>
      <p className={styles.note}>{copy.note}</p>
      <PriceTable book={book} onDone={saved(copy.withdrawn)} />
      {said !== null && (
        <InlineMessage tone="saved" className={styles.saved}>
          {said}
        </InlineMessage>
      )}
      {mayAdd && <PriceForm book={book} onSaved={saved(copy.added)} />}
    </Panel>
  );
}
