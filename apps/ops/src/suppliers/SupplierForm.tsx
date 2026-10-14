// Adding a supplier, or changing one (docs/decisions/0165-suppliers.md): its name, GST number, country and currency,
// a contact, and its payment terms and warranty. The check shows each field that changes, old beside new, before
// anything is sent (ADR 0071).

import type { Success } from "@maneman/web-kit/api";
import { Field, TextInput } from "@maneman/ui/Field";
import { useState } from "react";
import type { paths } from "../api-schema.ts";
import { settings } from "../content/settings.ts";
import form from "../components/forms.module.css";
import { SettingForm, sentOf, useSteps } from "../settings/index.ts";
import { suppliersApi } from "./suppliers-api.ts";

export type Suppliers = Success<paths["/api/suppliers"]["get"]>;
export type Supplier = Suppliers["suppliers"][number];

const copy = settings.suppliers;
const formWords = copy.form;
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
  const said = (value: string | number | null) => (value === null ? formWords.confirm.none : String(value));
  const fields: readonly (readonly [keyof typeof now, string])[] = [
    ["name", formWords.name],
    ["gstin", formWords.gstin],
    ["country", formWords.country],
    ["currency", formWords.currency],
    ["contact_name", formWords.contactName],
    ["contact_phone", formWords.contactPhone],
    ["contact_email", formWords.contactEmail],
    ["payment_terms_days", formWords.terms],
    ["warranty_days", formWords.warranty],
  ];
  return fields
    .filter(([field]) => was[field] !== now[field])
    .map(([field, label]) => formWords.confirm.line(label, said(was[field]), said(now[field])));
}

function SupplierEntry(props: {
  label: string;
  value: string;
  size?: string;
  max: number;
  onChange: (text: string) => void;
}) {
  return (
    <Field label={props.label} className={form.field}>
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
      <div className={form.fields}>
        <SupplierEntry label={formWords.name} value={draft.name} size={form.areaBox} max={80} onChange={edit("name")} />
        <SupplierEntry
          label={formWords.gstin}
          value={draft.gstin}
          size={form.areaBox}
          max={15}
          onChange={edit("gstin")}
        />
        <SupplierEntry
          label={formWords.country}
          value={draft.country}
          size={form.figureBox}
          max={2}
          onChange={edit("country")}
        />
        <SupplierEntry
          label={formWords.currency}
          value={draft.currency}
          size={form.figureBox}
          max={3}
          onChange={edit("currency")}
        />
      </div>
      <div className={form.fields}>
        <SupplierEntry
          label={formWords.contactName}
          value={draft.contactName}
          size={form.areaBox}
          max={80}
          onChange={edit("contactName")}
        />
        <SupplierEntry
          label={formWords.contactPhone}
          value={draft.contactPhone}
          size={form.areaBox}
          max={16}
          onChange={edit("contactPhone")}
        />
        <SupplierEntry
          label={formWords.contactEmail}
          value={draft.contactEmail}
          size={form.areaBox}
          max={120}
          onChange={edit("contactEmail")}
        />
      </div>
      <div className={form.fields}>
        <SupplierEntry
          label={formWords.terms}
          value={draft.terms}
          size={form.figureBox}
          max={3}
          onChange={edit("terms")}
        />
        <SupplierEntry
          label={formWords.warranty}
          value={draft.warranty}
          size={form.figureBox}
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
  onSaved: (suppliers: Suppliers, said: string) => void;
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
        supplier === null ? await suppliersApi.addSupplier(body) : await suppliersApi.changeSupplier(supplier.id, body);
      return sentOf(answer, (suppliers) => ({ suppliers }));
    },
    (sent) => {
      onSaved(sent.suppliers, supplier === null ? formWords.added : formWords.saved);
    },
  );
  const edit = (field: keyof Draft) => (text: string) => {
    setDraft({ ...draft, [field]: text });
    steps.edit();
  };
  const body = bodyOf(draft);
  const lines =
    supplier === null ? [formWords.confirm.adding(body.name, body.country, body.currency)] : changes(supplier, draft);

  return (
    <SettingForm
      title={supplier === null ? formWords.addTitle : formWords.changeTitle(supplier.name)}
      steps={steps}
      ready={ready}
      errors={copy.errors}
      onCancel={onCancel}
      sendable={lines.length > 0}
      checking={(lines.length === 0 ? [formWords.confirm.nothing] : lines).map((line) => (
        <p className={form.checkLine} key={line}>
          {line}
        </p>
      ))}
    >
      <SupplierBoxes draft={draft} edit={edit} />
    </SettingForm>
  );
}
