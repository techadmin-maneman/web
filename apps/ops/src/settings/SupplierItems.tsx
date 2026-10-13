// What a supplier supplies (docs/decisions/0165-suppliers.md): for each stock code their code, the price of one in
// their currency, the pack it comes in, the least they take, and the lead time they promise. Setting an item shows the
// old beside the new before it is sent (ADR 0071); removing one takes it off their list.

import { Field, Select, TextInput } from "@maneman/ui/Field";
import { Table } from "@maneman/ui/Table";
import { inCurrency } from "@maneman/web-kit/money";
import { useState } from "react";
import { client } from "../api.ts";
import { settings } from "../content/settings.ts";
import { useAccess } from "../lib/access.ts";
import styles from "../components/forms.module.css";
import { SettingForm, sentOf, useSteps } from "./SettingForm.tsx";
import type { Supplier, Suppliers } from "./SupplierForm.tsx";

const copy = settings.suppliers;
const words = copy.item;
const AMOUNT = /^\d{1,9}(?:\.\d{1,2})?$/;
const WHOLE = /^\d{1,6}$/;

type Item = Supplier["items"][number];

interface Draft {
  readonly code: string;
  readonly theirCode: string;
  readonly price: string;
  readonly pack: string;
  readonly minimum: string;
  readonly lead: string;
}

const draftOf = (book: Suppliers, item: Item | null): Draft => ({
  code: item?.consumable_code ?? book.consumables[0]?.code ?? "",
  theirCode: item?.their_code ?? "",
  price: item === null ? "" : String(item.unit_price / 100),
  pack: String(item?.pack_size ?? 1),
  minimum: String(item?.minimum_order ?? 1),
  lead: item === null ? "" : String(item.lead_time_days),
});

function Entry(props: { label: string; value: string; onChange: (text: string) => void }) {
  return (
    <Field label={props.label} className={styles.field}>
      {(control) => (
        <TextInput
          {...control}
          className={styles.figureBox}
          maxLength={12}
          value={props.value}
          onChange={(event) => {
            props.onChange(event.target.value);
          }}
        />
      )}
    </Field>
  );
}

/** The item's boxes: the stock code, which starts from what the supplier lists of it, and its figures. */
function ItemBoxes(props: {
  book: Suppliers;
  supplier: Supplier;
  draft: Draft;
  onDraft: (draft: Draft) => void;
  edit: (field: keyof Draft) => (text: string) => void;
  onPick: () => void;
}) {
  const { book, supplier, draft, onDraft, edit, onPick } = props;
  const unit = book.consumables.find((each) => each.code === draft.code)?.unit ?? "";
  return (
    <>
      <div className={styles.fields}>
        <Field label={words.consumable} className={styles.field}>
          {(control) => (
            <Select
              {...control}
              className={styles.choiceBox}
              value={draft.code}
              onChange={(event) => {
                // A stock code already listed starts from what it holds; a new one from nothing.
                const code = event.target.value;
                const listed = supplier.items.find((item) => item.consumable_code === code);
                onDraft(listed === undefined ? { ...draftOf(book, null), code } : draftOf(book, listed));
                onPick();
              }}
            >
              {book.consumables.map((each) => (
                <option key={each.code} value={each.code}>
                  {each.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Entry label={words.theirCode} value={draft.theirCode} onChange={edit("theirCode")} />
        <Entry label={words.price(supplier.currency, unit)} value={draft.price} onChange={edit("price")} />
      </div>
      <div className={styles.fields}>
        <Entry label={words.pack(unit)} value={draft.pack} onChange={edit("pack")} />
        <Entry label={words.minimum} value={draft.minimum} onChange={edit("minimum")} />
        <Entry label={words.lead} value={draft.lead} onChange={edit("lead")} />
      </div>
    </>
  );
}

/** "Solvent · USD 12.50 per ml · Pack 12 ml · Minimum 24 ml · 21 days" */
const itemLine = (name: string, unit: string, item: Omit<Item, "consumable_code" | "their_code">, currency: string) =>
  `${name} · ${words.perUnit(inCurrency(item.unit_price, currency), unit)} · ${words.packOf(words.amount(item.pack_size, unit))} · ` +
  `${words.minimum} ${words.amount(item.minimum_order, unit)} · ${words.days(item.lead_time_days)}`;

function ItemForm({
  book,
  supplier,
  onSaved,
}: {
  book: Suppliers;
  supplier: Supplier;
  onSaved: (book: Suppliers, said: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(book, null));
  const was = supplier.items.find((item) => item.consumable_code === draft.code) ?? null;
  const ready =
    draft.code !== "" &&
    AMOUNT.test(draft.price.trim()) &&
    [draft.pack, draft.minimum, draft.lead].every((figure) => WHOLE.test(figure.trim())) &&
    Number(draft.pack) > 0 &&
    Number(draft.minimum) > 0;
  const body = {
    consumable_code: draft.code,
    their_code: draft.theirCode.trim() === "" ? null : draft.theirCode.trim(),
    unit_price: Math.round(Number(draft.price) * 100),
    pack_size: Number(draft.pack),
    minimum_order: Number(draft.minimum),
    lead_time_days: Number(draft.lead),
  };
  const steps = useSteps(
    async () =>
      sentOf(await client.post("/api/suppliers/{id}/items", { path: { id: supplier.id }, body }), (next) => ({ next })),
    (sent) => {
      onSaved(sent.next, words.saved);
      setDraft(draftOf(book, null));
    },
  );
  const edit = (field: keyof Draft) => (text: string) => {
    setDraft({ ...draft, [field]: text });
    steps.edit();
  };
  const listed = book.consumables.find((each) => each.code === draft.code);
  const name = listed?.name ?? draft.code;
  const unit = listed?.unit ?? "";
  const line = itemLine(name, unit, body, supplier.currency);
  const before = was === null ? null : itemLine(name, unit, was, supplier.currency);
  return (
    <SettingForm
      title={words.title(supplier.name)}
      steps={steps}
      ready={ready}
      words={{
        next: words.set,
        cancel: copy.form.cancel,
        checkTitle: copy.form.confirm.title,
        send: copy.form.confirm.send,
        saving: copy.form.saving,
        back: copy.form.confirm.back,
      }}
      errors={copy.errors}
      onCancel={null}
      checking={[before === null ? line : copy.form.confirm.line(name, before, line)].map((each) => (
        <p className={styles.checkLine} key={each}>
          {each}
        </p>
      ))}
    >
      <ItemBoxes book={book} supplier={supplier} draft={draft} onDraft={setDraft} edit={edit} onPick={steps.edit} />
    </SettingForm>
  );
}

export function SupplierItems({
  book,
  supplier,
  onSaved,
}: {
  book: Suppliers;
  supplier: Supplier;
  onSaved: (book: Suppliers, said: string) => void;
}) {
  const access = useAccess();
  const named = (code: string) => book.consumables.find((each) => each.code === code)?.name ?? code;
  const unitOf = (code: string) => book.consumables.find((each) => each.code === code)?.unit ?? "";
  const remove = async (code: string) => {
    const answer = await client.post("/api/suppliers/{id}/items/{code}/remove", { path: { id: supplier.id, code } });
    if (answer.ok) onSaved(answer.body, words.removed);
  };
  return (
    <section className={styles.panel} aria-labelledby="supplier-items">
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle} id="supplier-items">
          {words.title(supplier.name)}
        </h2>
      </div>
      {supplier.items.length === 0 ? (
        <p className={styles.note}>{words.none}</p>
      ) : (
        <Table className={styles.table}>
          <thead>
            <tr>
              {words.columns.map((column) => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {supplier.items.map((item) => (
              <tr key={item.consumable_code}>
                <th scope="row" className={styles.rowHead}>
                  {named(item.consumable_code)}
                </th>
                <td>{item.their_code ?? ""}</td>
                <td className={styles.figure}>
                  {words.perUnit(inCurrency(item.unit_price, supplier.currency), unitOf(item.consumable_code))}
                </td>
                <td className={styles.figure}>{words.amount(item.pack_size, unitOf(item.consumable_code))}</td>
                <td className={styles.figure}>{words.amount(item.minimum_order, unitOf(item.consumable_code))}</td>
                <td className={styles.figure}>{words.days(item.lead_time_days)}</td>
                <td>
                  {access.mayCall("POST /api/suppliers/{id}/items/{code}/remove") && (
                    <button
                      className={styles.inline}
                      type="button"
                      aria-label={words.removeLabel(named(item.consumable_code))}
                      onClick={() => void remove(item.consumable_code)}
                    >
                      {words.remove}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {access.mayCall("POST /api/suppliers/{id}/items") && (
        <ItemForm key={supplier.id} book={book} supplier={supplier} onSaved={onSaved} />
      )}
    </section>
  );
}
