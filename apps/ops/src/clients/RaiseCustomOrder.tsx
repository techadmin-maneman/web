// Raising a custom order (docs/decisions/0174-custom-orders.md): made to the client's profile, from a supplier at its
// price, with what the client pays and when the supplier promised it. Raising it sends the client the payment link.

import { InlineMessage } from "@maneman/ui/InlineMessage";
import { Button } from "@maneman/ui/Button";
import { Field, Select, TextInput } from "@maneman/ui/Field";
import { errorText, type Failure } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { client } from "../api.ts";
import type { paths } from "../api-schema.ts";
import form from "../components/forms.module.css";
import { clients } from "../content.ts";
import { customOrders as copy } from "../content/custom-orders.ts";
import { paiseFromRupees } from "@maneman/web-kit/money";

export type CustomOrdersBook =
  paths["/api/clients/{id}/custom-orders"]["get"]["responses"][200]["content"]["application/json"];

const WAVES = ["straight", "slight_wave", "wavy", "curly"] as const;

/** A figure typed in a currency's main unit, in its smallest: "150.50" is 15050. */
const smallest = paiseFromRupees;

interface Draft {
  supplierId: string;
  supplierPrice: string;
  amount: string;
  promised: string;
  wave: string;
  note: string;
}

function Entry(props: { label: string; value: string; type?: string; onChange: (text: string) => void }) {
  return (
    <Field label={props.label} className={form.field}>
      {(control) => (
        <TextInput
          {...control}
          type={props.type ?? "text"}
          maxLength={200}
          value={props.value}
          onChange={(event) => {
            props.onChange(event.target.value);
          }}
        />
      )}
    </Field>
  );
}

/** The order's boxes, each holding what was typed or chosen. */
function OrderBoxes({
  book,
  draft,
  edit,
}: {
  book: CustomOrdersBook;
  draft: Draft;
  edit: (field: keyof Draft) => (text: string) => void;
}) {
  const currency = book.suppliers.find((each) => each.id === draft.supplierId)?.currency ?? "";
  return (
    <>
      <Field label={copy.raise.supplier} className={form.field}>
        {(control) => (
          <Select
            {...control}
            value={draft.supplierId}
            onChange={(event) => {
              edit("supplierId")(event.target.value);
            }}
          >
            {book.suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Entry label={copy.raise.supplierPrice(currency)} value={draft.supplierPrice} onChange={edit("supplierPrice")} />
      <Entry label={copy.raise.amount} value={draft.amount} onChange={edit("amount")} />
      <Entry label={copy.raise.promised} type="date" value={draft.promised} onChange={edit("promised")} />
      <Field label={copy.raise.wave} className={form.field}>
        {(control) => (
          <Select
            {...control}
            value={draft.wave}
            onChange={(event) => {
              edit("wave")(event.target.value);
            }}
          >
            <option value="">{copy.raise.noWave}</option>
            {WAVES.map((each) => (
              <option key={each} value={each}>
                {clients.profile.waves[each]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Entry label={copy.raise.note} value={draft.note} onChange={edit("note")} />
    </>
  );
}

export function RaiseCustomOrder({
  clientId,
  book,
  onRaised,
  onClose,
}: {
  clientId: string;
  book: CustomOrdersBook;
  onRaised: (book: CustomOrdersBook, said: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Draft>({
    supplierId: book.suppliers[0]?.id ?? "",
    supplierPrice: "",
    amount: "",
    promised: "",
    wave: "",
    note: "",
  });
  const [failure, setFailure] = useState<Failure | null>(null);
  const edit = (field: keyof Draft) => (text: string) => {
    setDraft((before) => ({ ...before, [field]: text }));
  };
  const ready = draft.supplierId !== "" && draft.supplierPrice !== "" && smallest(draft.amount) >= 100;
  const raise = async () => {
    const answer = await client.post("/api/clients/{id}/custom-orders", {
      path: { id: clientId },
      body: {
        supplier_id: draft.supplierId,
        supplier_price: smallest(draft.supplierPrice),
        amount: smallest(draft.amount),
        promised_on: draft.promised === "" ? null : draft.promised,
        wave: WAVES.find((each) => each === draft.wave) ?? null,
        note: draft.note.trim() === "" ? null : draft.note.trim(),
      },
    });
    if (answer.ok) onRaised(answer.body, copy.raise.raised);
    else setFailure({ code: answer.code, fields: answer.fields });
  };
  return (
    <div className={form.group}>
      <h3 className={form.fieldLabel}>{copy.raise.title}</h3>
      <OrderBoxes book={book} draft={draft} edit={edit} />
      <div className={form.actions}>
        <Button variant="primary" size="small" disabled={!ready} onClick={() => void raise()}>
          {copy.raise.send}
        </Button>
        <Button variant="outline" size="small" onClick={onClose}>
          {copy.raise.keep}
        </Button>
      </div>
      {failure !== null && (
        <InlineMessage tone="error" className={form.error}>
          {errorText(copy.errors, failure)}
        </InlineMessage>
      )}
    </div>
  );
}
