// What a supplier supplies (docs/decisions/0165-suppliers.md): for each stock code their code, the price of one in
// their currency, the pack it comes in, the least they take, and the lead time they promise. Setting an item shows the
// old beside the new before it is sent (ADR 0071); removing one takes it off their list.

import { CheckLine } from "../components/CheckPanel.tsx";
import { Panel } from "@maneman/ui/Panel";
import { RowButton } from "@maneman/ui/Button";
import { Field, Select, TextInput } from "@maneman/ui/Field";
import { Table } from "@maneman/ui/Table";
import { inCurrency, paiseFromRupees } from "@maneman/web-kit/money";
import { useState } from "react";
import { settings } from "../content/settings.ts";
import { useAccess } from "../lib/access.ts";
import form from "../components/forms.module.css";
import { ActionCheck, SettingForm, sentOf, useSteps } from "../settings/index.ts";
import type { Supplier, Suppliers } from "./SupplierForm.tsx";
import { RowHead } from "../components/RowHead.tsx";
import { suppliersApi } from "./suppliers-api.ts";

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

const draftOf = (suppliers: Suppliers, item: Item | null): Draft => ({
  code: item?.consumable_code ?? suppliers.consumables[0]?.code ?? "",
  theirCode: item?.their_code ?? "",
  price: item === null ? "" : String(item.unit_price / 100),
  pack: String(item?.pack_size ?? 1),
  minimum: String(item?.minimum_order ?? 1),
  lead: item === null ? "" : String(item.lead_time_days),
});

function ItemEntry(props: { label: string; value: string; onChange: (text: string) => void }) {
  return (
    <Field label={props.label} className={form.field}>
      {(control) => (
        <TextInput
          {...control}
          className={form.figureBox}
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
  suppliers: Suppliers;
  supplier: Supplier;
  draft: Draft;
  onDraft: (draft: Draft) => void;
  edit: (field: keyof Draft) => (text: string) => void;
  onPick: () => void;
}) {
  const { suppliers, supplier, draft, onDraft, edit, onPick } = props;
  const unit = suppliers.consumables.find((each) => each.code === draft.code)?.unit ?? "";
  return (
    <>
      <div className={form.fields}>
        <Field label={words.consumable} className={form.field}>
          {(control) => (
            <Select
              {...control}
              className={form.choiceBox}
              value={draft.code}
              onChange={(event) => {
                // A stock code already listed starts from what it holds; a new one from nothing.
                const code = event.target.value;
                const listed = supplier.items.find((item) => item.consumable_code === code);
                onDraft(listed === undefined ? { ...draftOf(suppliers, null), code } : draftOf(suppliers, listed));
                onPick();
              }}
            >
              {suppliers.consumables.map((each) => (
                <option key={each.code} value={each.code}>
                  {each.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <ItemEntry label={words.theirCode} value={draft.theirCode} onChange={edit("theirCode")} />
        <ItemEntry label={words.price(supplier.currency, unit)} value={draft.price} onChange={edit("price")} />
      </div>
      <div className={form.fields}>
        <ItemEntry label={words.pack(unit)} value={draft.pack} onChange={edit("pack")} />
        <ItemEntry label={words.minimum} value={draft.minimum} onChange={edit("minimum")} />
        <ItemEntry label={words.lead} value={draft.lead} onChange={edit("lead")} />
      </div>
    </>
  );
}

/** "Solvent · USD 12.50 per ml · Pack 12 ml · Minimum 24 ml · 21 days" */
const itemLine = (name: string, unit: string, item: Omit<Item, "consumable_code" | "their_code">, currency: string) =>
  `${name} · ${words.perUnit(inCurrency(item.unit_price, currency), unit)} · ${words.packOf(words.amount(item.pack_size, unit))} · ` +
  `${words.minimum} ${words.amount(item.minimum_order, unit)} · ${words.days(item.lead_time_days)}`;

function ItemForm({
  suppliers,
  supplier,
  onSaved,
}: {
  suppliers: Suppliers;
  supplier: Supplier;
  onSaved: (suppliers: Suppliers, said: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(suppliers, null));
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
    unit_price: paiseFromRupees(draft.price),
    pack_size: Number(draft.pack),
    minimum_order: Number(draft.minimum),
    lead_time_days: Number(draft.lead),
  };
  const steps = useSteps(
    async () => sentOf(await suppliersApi.setSupplierItem(supplier.id, body), (next) => ({ next })),
    (sent) => {
      onSaved(sent.next, words.saved);
      setDraft(draftOf(suppliers, null));
    },
  );
  const edit = (field: keyof Draft) => (text: string) => {
    setDraft({ ...draft, [field]: text });
    steps.edit();
  };
  const listed = suppliers.consumables.find((each) => each.code === draft.code);
  const name = listed?.name ?? draft.code;
  const unit = listed?.unit ?? "";
  const line = itemLine(name, unit, body, supplier.currency);
  const before = was === null ? null : itemLine(name, unit, was, supplier.currency);
  return (
    <SettingForm
      title={words.title(supplier.name)}
      steps={steps}
      ready={ready}
      errors={copy.errors}
      onCancel={null}
      checking={[before === null ? line : copy.form.confirm.line(name, before, line)].map((each) => (
        <CheckLine key={each}>{each}</CheckLine>
      ))}
    >
      <ItemBoxes
        suppliers={suppliers}
        supplier={supplier}
        draft={draft}
        onDraft={setDraft}
        edit={edit}
        onPick={steps.edit}
      />
    </SettingForm>
  );
}

/** A row's Remove, which asks before the item comes off the supplier's list. */
function RemoveItem(props: {
  supplier: Supplier;
  code: string;
  name: string;
  mayRemove: boolean;
  onSaved: (suppliers: Suppliers, said: string) => void;
}) {
  const [asking, setAsking] = useState(false);
  if (!props.mayRemove) return null;
  if (!asking) {
    return (
      <RowButton
        className={form.inline}
        aria-label={words.removeLabel(props.name)}
        onClick={() => {
          setAsking(true);
        }}
      >
        {words.remove}
      </RowButton>
    );
  }
  return (
    <ActionCheck
      label={words.remove}
      question={words.removeQuestion(props.name, props.supplier.name)}
      send={async () =>
        sentOf(await suppliersApi.removeSupplierItem(props.supplier.id, props.code), (next) => ({ next }))
      }
      onDone={(sent) => {
        setAsking(false);
        props.onSaved(sent.next, words.removed);
      }}
      errors={copy.errors}
      onCancel={() => {
        setAsking(false);
      }}
    />
  );
}

export function SupplierItems({
  suppliers,
  supplier,
  onSaved,
}: {
  suppliers: Suppliers;
  supplier: Supplier;
  onSaved: (suppliers: Suppliers, said: string) => void;
}) {
  const access = useAccess();
  const named = (code: string) => suppliers.consumables.find((each) => each.code === code)?.name ?? code;
  const unitOf = (code: string) => suppliers.consumables.find((each) => each.code === code)?.unit ?? "";
  return (
    <Panel titleId="supplier-items" title={words.title(supplier.name)}>
      {supplier.items.length === 0 ? (
        <p className={form.note}>{words.none}</p>
      ) : (
        <Table className={form.table}>
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
                <RowHead>{named(item.consumable_code)}</RowHead>
                <td>{item.their_code ?? ""}</td>
                <td className={form.figure}>
                  {words.perUnit(inCurrency(item.unit_price, supplier.currency), unitOf(item.consumable_code))}
                </td>
                <td className={form.figure}>{words.amount(item.pack_size, unitOf(item.consumable_code))}</td>
                <td className={form.figure}>{words.amount(item.minimum_order, unitOf(item.consumable_code))}</td>
                <td className={form.figure}>{words.days(item.lead_time_days)}</td>
                <td>
                  <RemoveItem
                    supplier={supplier}
                    code={item.consumable_code}
                    name={named(item.consumable_code)}
                    mayRemove={access.mayCall("POST /api/suppliers/{id}/items/{code}/remove")}
                    onSaved={onSaved}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {access.mayCall("POST /api/suppliers/{id}/items") && (
        <ItemForm key={supplier.id} suppliers={suppliers} supplier={supplier} onSaved={onSaved} />
      )}
    </Panel>
  );
}
