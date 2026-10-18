// What a supplier supplies (docs/decisions/0165-suppliers.md), in its record: for each stock code their code, the
// price of one in their currency, the pack it comes in, the least they take, and the lead time they promise. A line
// opens its values, each changed where it reads, and removing it takes it off their list once asked.

import { Button } from "@maneman/ui/Button";
import { Field, Select, TextInput } from "@maneman/ui/Field";
import { Note } from "@maneman/ui/Note";
import { TextButton } from "@maneman/ui/TextLink";
import { inCurrency, paiseFromRupees } from "@maneman/web-kit/money";
import { errorText } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { AddForm } from "../components/AddForm.tsx";
import { DeleteAction } from "../components/DeleteAction.tsx";
import { figureOrNone, FigureRow, TextRow } from "../components/RecordRows.tsx";
import form from "../components/forms.module.css";
import { settings } from "../content/settings.ts";
import { useAccess } from "../lib/access.ts";
import { suppliersApi, type Supplier, type SupplierItem, type Suppliers } from "./suppliers-api.ts";
import styles from "./suppliers.module.css";

const copy = settings.suppliers;
const words = copy.item;
const AMOUNT = /^\d{1,9}(?:\.\d{1,2})?$/;

type Item = Supplier["items"][number];

interface Props {
  readonly suppliers: Suppliers;
  readonly supplier: Supplier;
  readonly onSaved: (suppliers: Suppliers) => void;
}

/** "Solvent · USD 12.50 per ml · Pack 12 ml · Minimum 24 ml · 21 days" */
const itemLine = (name: string, unit: string, item: Item, currency: string) =>
  `${name} · ${words.perUnit(inCurrency(item.unit_price, currency), unit)} · ${words.packOf(words.amount(item.pack_size, unit))} · ` +
  `${words.minimum} ${words.amount(item.minimum_order, unit)} · ${words.days(item.lead_time_days)}`;

/** One stock code's values, each changed where it reads, and its removal. */
function ItemRecord(props: Props & { readonly item: Item; readonly name: string; readonly unit: string }) {
  const { supplier, item, name, unit, onSaved } = props;
  const access = useAccess();
  const mayChange = access.mayCall("POST /api/suppliers/{id}/items");
  const save = async (change: Partial<SupplierItem>) => {
    const answer = await suppliersApi.setSupplierItem(supplier.id, { ...item, ...change });
    if (!answer.ok) return errorText(copy.errors, answer);
    onSaved(answer.body);
    return null;
  };
  const whole = (field: "pack_size" | "minimum_order" | "lead_time_days", least: number) => (typed: string) => {
    const figure = figureOrNone(typed);
    return figure === undefined || figure === null || figure < least
      ? Promise.resolve(copy.errors[field])
      : save({ [field]: figure });
  };
  return (
    <div className={styles.item} role="group" aria-label={name}>
      <TextRow
        label={words.rows.theirCode}
        value={item.their_code ?? ""}
        shown={item.their_code ?? copy.rows.none}
        maxLength={40}
        mayChange={mayChange}
        save={(typed) => save({ their_code: typed.trim() === "" ? null : typed.trim() })}
      />
      <FigureRow
        label={words.rows.price(unit)}
        value={item.unit_price / 100}
        shown={inCurrency(item.unit_price, supplier.currency)}
        unit={supplier.currency}
        mayChange={mayChange}
        save={(typed) =>
          AMOUNT.test(typed.trim())
            ? save({ unit_price: paiseFromRupees(typed) })
            : Promise.resolve(copy.errors.unit_price)
        }
      />
      <FigureRow
        label={words.rows.pack}
        value={item.pack_size}
        shown={words.amount(item.pack_size, unit)}
        unit={unit}
        mayChange={mayChange}
        save={whole("pack_size", 1)}
      />
      <FigureRow
        label={words.minimum}
        value={item.minimum_order}
        shown={words.amount(item.minimum_order, unit)}
        unit={unit}
        mayChange={mayChange}
        save={whole("minimum_order", 1)}
      />
      <FigureRow
        label={words.rows.lead}
        value={item.lead_time_days}
        shown={words.days(item.lead_time_days)}
        unit={copy.rows.days}
        mayChange={mayChange}
        save={whole("lead_time_days", 0)}
      />
      {access.mayCall("POST /api/suppliers/{id}/items/{code}/remove") && (
        <div className={form.recordFoot}>
          <DeleteAction
            name={name}
            tone="danger"
            words={{ ...words.removing, warning: (item: string) => words.removeQuestion(item, supplier.name) }}
            send={() => suppliersApi.removeSupplierItem(supplier.id, item.consumable_code)}
            refusal={(code) => errorText(copy.errors, { code })}
            onDeleted={onSaved}
          />
        </div>
      )}
    </div>
  );
}

/** A stock code the supplier does not list yet, with its figures. */
function AddItem(props: Props & { readonly onDone: () => void }) {
  const { suppliers, supplier } = props;
  const unlisted = suppliers.consumables.filter(
    (each) => !supplier.items.some((item) => item.consumable_code === each.code),
  );
  const [draft, setDraft] = useState({
    code: unlisted[0]?.code ?? "",
    theirCode: "",
    price: "",
    pack: "1",
    minimum: "1",
    lead: "",
  });
  const unit = suppliers.consumables.find((each) => each.code === draft.code)?.unit ?? "";
  const box = (field: "theirCode" | "price" | "pack" | "minimum" | "lead", label: string, name: string) => (
    <Field label={label} className={form.field} box={name}>
      {(control) => (
        <TextInput
          {...control}
          width="figure"
          maxLength={12}
          value={draft[field]}
          onChange={(event) => {
            setDraft({ ...draft, [field]: event.target.value });
          }}
        />
      )}
    </Field>
  );
  if (unlisted.length === 0) return <Note>{words.allListed}</Note>;
  return (
    <AddForm
      title={words.addOne}
      words={copy.form}
      errors={copy.errors}
      boxes={["consumable_code", "their_code", "unit_price", "pack_size", "minimum_order", "lead_time_days"]}
      send={() =>
        suppliersApi.setSupplierItem(supplier.id, {
          consumable_code: draft.code,
          their_code: draft.theirCode.trim() === "" ? null : draft.theirCode.trim(),
          unit_price: paiseFromRupees(draft.price),
          pack_size: Number(draft.pack),
          minimum_order: Number(draft.minimum),
          lead_time_days: Number(draft.lead),
        })
      }
      onAdded={(next) => {
        props.onSaved(next);
        props.onDone();
      }}
      onCancel={props.onDone}
    >
      <div className={form.fields}>
        <Field label={words.consumable} className={form.field} box="consumable_code">
          {(control) => (
            <Select
              {...control}
              width="choice"
              value={draft.code}
              onChange={(event) => {
                setDraft({ ...draft, code: event.target.value });
              }}
            >
              {unlisted.map((each) => (
                <option key={each.code} value={each.code}>
                  {each.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {box("theirCode", words.theirCode, "their_code")}
        {box("price", words.price(supplier.currency, unit), "unit_price")}
        {box("pack", words.pack(unit), "pack_size")}
        {box("minimum", words.minimum, "minimum_order")}
        {box("lead", words.lead, "lead_time_days")}
      </div>
    </AddForm>
  );
}

export function SupplierItems(props: Props) {
  const { suppliers, supplier } = props;
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const mayAdd = useAccess().mayCall("POST /api/suppliers/{id}/items");
  const listed = (code: string) => suppliers.consumables.find((each) => each.code === code);
  return (
    <section className={styles.items} aria-labelledby="supplier-items">
      <h3 id="supplier-items" className={styles.itemsTitle}>
        {words.title(supplier.name)}
      </h3>
      {supplier.items.length === 0 && <Note>{words.none}</Note>}
      <ul className={styles.itemList}>
        {supplier.items.map((item) => {
          const name = listed(item.consumable_code)?.name ?? item.consumable_code;
          const unit = listed(item.consumable_code)?.unit ?? "";
          const isOpen = open === item.consumable_code;
          return (
            <li key={item.consumable_code}>
              <TextButton
                compact
                aria-expanded={isOpen}
                onClick={() => {
                  setOpen(isOpen ? null : item.consumable_code);
                }}
              >
                {itemLine(name, unit, item, supplier.currency)}
              </TextButton>
              {isOpen && <ItemRecord {...props} item={item} name={name} unit={unit} />}
            </li>
          );
        })}
      </ul>
      {mayAdd &&
        (adding ? (
          <AddItem
            {...props}
            onDone={() => {
              setAdding(false);
            }}
          />
        ) : (
          <Button
            variant="outline"
            size="small"
            onClick={() => {
              setAdding(true);
            }}
          >
            {words.addOne}
          </Button>
        ))}
    </section>
  );
}
