// Adding a supplier, or changing one (docs/decisions/0165-suppliers.md): its name, GST number, country and currency,
// a contact, and its payment terms and warranty. The check shows each field that changes, old beside new, before
// anything is sent (ADR 0071).

import { Field, TextInput } from "@maneman/ui/Field";
import { useState } from "react";
import { client } from "../api.ts";
import type { paths } from "../api-schema.ts";
import { settings } from "../content/settings.ts";
import styles from "../components/forms.module.css";
import { SettingForm, sentOf, useSteps } from "./SettingForm.tsx";

export type Suppliers = paths["/api/suppliers"]["get"]["responses"][200]["content"]["application/json"];
export type Supplier = Suppliers["suppliers"][number];

const copy = settings.suppliers;
const form = copy.form;
const WHOLE = /^\d{1,4}$/;

interface Draft {
  readonly name: string;
  readonly gstin: string;
  readonly country: string;
  readonly currency: string;
  readonly contactName: string;
  readonly contactPhone: string;
  readonly contactEmail: string;
  readonly terms: string;
  readonly warranty: string;
}

const draftOf = (supplier: Supplier | null): Draft => ({
  name: supplier?.name ?? "",
  gstin: supplier?.gstin ?? "",
  country: supplier?.country ?? "IN",
  currency: supplier?.currency ?? "INR",
  contactName: supplier?.contact_name ?? "",
  contactPhone: supplier?.contact_phone ?? "",
  contactEmail: supplier?.contact_email ?? "",
  terms: String(supplier?.payment_terms_days ?? 0),
  warranty: String(supplier?.warranty_days ?? 0),
});

const orNull = (text: string) => (text.trim() === "" ? null : text.trim());

function bodyOf(draft: Draft) {
  return {
    name: draft.name.trim(),
    gstin: orNull(draft.gstin.toUpperCase()),
    country: draft.country.trim().toUpperCase(),
    currency: draft.currency.trim().toUpperCase(),
    contact_name: orNull(draft.contactName),
    contact_phone: orNull(draft.contactPhone),
    contact_email: orNull(draft.contactEmail),
    payment_terms_days: Number(draft.terms),
    warranty_days: Number(draft.warranty),
  };
}

/** What the change is, field by field, each old beside new; empty when nothing changes. */
function changes(was: Supplier, draft: Draft): string[] {
  const now = bodyOf(draft);
  const said = (value: string | number | null) => (value === null ? form.confirm.none : String(value));
  const fields: readonly (readonly [keyof typeof now, string])[] = [
    ["name", form.name],
    ["gstin", form.gstin],
    ["country", form.country],
    ["currency", form.currency],
    ["contact_name", form.contactName],
    ["contact_phone", form.contactPhone],
    ["contact_email", form.contactEmail],
    ["payment_terms_days", form.terms],
    ["warranty_days", form.warranty],
  ];
  return fields
    .filter(([field]) => was[field] !== now[field])
    .map(([field, label]) => form.confirm.line(label, said(was[field]), said(now[field])));
}

function Entry(props: { label: string; value: string; size?: string; max: number; onChange: (text: string) => void }) {
  return (
    <Field label={props.label} className={styles.field}>
      {(control) => (
        <TextInput
          {...control}
          className={props.size}
          maxLength={props.max}
          value={props.value}
          onChange={(event) => {
            props.onChange(event.target.value);
          }}
        />
      )}
    </Field>
  );
}

/** The supplier's boxes, each holding text as typed. */
function SupplierBoxes({ draft, edit }: { draft: Draft; edit: (field: keyof Draft) => (text: string) => void }) {
  return (
    <>
      <div className={styles.fields}>
        <Entry label={form.name} value={draft.name} size={styles.areaBox} max={80} onChange={edit("name")} />
        <Entry label={form.gstin} value={draft.gstin} size={styles.areaBox} max={15} onChange={edit("gstin")} />
        <Entry label={form.country} value={draft.country} size={styles.figureBox} max={2} onChange={edit("country")} />
        <Entry
          label={form.currency}
          value={draft.currency}
          size={styles.figureBox}
          max={3}
          onChange={edit("currency")}
        />
      </div>
      <div className={styles.fields}>
        <Entry
          label={form.contactName}
          value={draft.contactName}
          size={styles.areaBox}
          max={80}
          onChange={edit("contactName")}
        />
        <Entry
          label={form.contactPhone}
          value={draft.contactPhone}
          size={styles.areaBox}
          max={16}
          onChange={edit("contactPhone")}
        />
        <Entry
          label={form.contactEmail}
          value={draft.contactEmail}
          size={styles.areaBox}
          max={120}
          onChange={edit("contactEmail")}
        />
      </div>
      <div className={styles.fields}>
        <Entry label={form.terms} value={draft.terms} size={styles.figureBox} max={3} onChange={edit("terms")} />
        <Entry
          label={form.warranty}
          value={draft.warranty}
          size={styles.figureBox}
          max={4}
          onChange={edit("warranty")}
        />
      </div>
    </>
  );
}

export function SupplierForm({
  supplier,
  onSaved,
  onCancel,
}: {
  /** The one to change; null to add a new one. */
  supplier: Supplier | null;
  onSaved: (book: Suppliers, said: string) => void;
  onCancel: (() => void) | null;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(supplier));
  const ready =
    draft.name.trim() !== "" &&
    /^[A-Za-z]{2}$/.test(draft.country.trim()) &&
    /^[A-Za-z]{3}$/.test(draft.currency.trim()) &&
    WHOLE.test(draft.terms.trim()) &&
    WHOLE.test(draft.warranty.trim());
  const steps = useSteps(
    async () => {
      const body = bodyOf(draft);
      const answer =
        supplier === null
          ? await client.post("/api/suppliers", { body })
          : await client.post("/api/suppliers/{id}", { path: { id: supplier.id }, body });
      return sentOf(answer, (book) => ({ book }));
    },
    (sent) => {
      onSaved(sent.book, supplier === null ? form.added : form.saved);
    },
  );
  const edit = (field: keyof Draft) => (text: string) => {
    setDraft({ ...draft, [field]: text });
    steps.edit();
  };
  const body = bodyOf(draft);
  const lines =
    supplier === null ? [form.confirm.adding(body.name, body.country, body.currency)] : changes(supplier, draft);

  return (
    <SettingForm
      title={supplier === null ? form.addTitle : form.changeTitle(supplier.name)}
      steps={steps}
      ready={ready}
      words={{
        next: supplier === null ? form.add : form.save,
        cancel: form.cancel,
        checkTitle: form.confirm.title,
        send: form.confirm.send,
        saving: form.saving,
        back: form.confirm.back,
      }}
      errors={copy.errors}
      onCancel={onCancel}
      sendable={lines.length > 0}
      checking={(lines.length === 0 ? [form.confirm.nothing] : lines).map((line) => (
        <p className={styles.checkLine} key={line}>
          {line}
        </p>
      ))}
    >
      <SupplierBoxes draft={draft} edit={edit} />
    </SettingForm>
  );
}
