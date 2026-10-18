// Adding a supplier (docs/decisions/0165-suppliers.md): its name, GST number, country and currency, a contact, and its
// payment terms and warranty. Once added, each changes where it reads in its record.

import { Field, TextInput, type BoxWidth } from "@maneman/ui/Field";
import { useState } from "react";
import { AddForm } from "../components/AddForm.tsx";
import form from "../components/forms.module.css";
import { settings } from "../content/settings.ts";
import { suppliersApi, type Suppliers } from "./suppliers-api.ts";

const copy = settings.suppliers;
const formWords = copy.form;

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

const BLANK: Draft = {
  name: "",
  gstin: "",
  country: "IN",
  currency: "INR",
  contactName: "",
  contactPhone: "",
  contactEmail: "",
  terms: "0",
  warranty: "0",
};

const orNull = (text: string) => (text.trim() === "" ? null : text.trim());

/** Each box: what it fills, the name the API refuses it by, how wide it is and how much it takes. */
const BOXES: readonly (readonly [keyof Draft, string, BoxWidth, number])[] = [
  ["name", "name", "area", 80],
  ["gstin", "gstin", "area", 15],
  ["country", "country", "figure", 2],
  ["currency", "currency", "figure", 3],
  ["contactName", "contact_name", "area", 80],
  ["contactPhone", "contact_phone", "area", 16],
  ["contactEmail", "contact_email", "area", 120],
  ["terms", "payment_terms_days", "figure", 3],
  ["warranty", "warranty_days", "figure", 4],
];

export function AddSupplier(props: {
  readonly onAdded: (suppliers: Suppliers) => void;
  readonly onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(BLANK);
  return (
    <AddForm
      title={formWords.addTitle}
      words={formWords}
      errors={copy.errors}
      boxes={BOXES.map(([, box]) => box)}
      send={() =>
        suppliersApi.addSupplier({
          name: draft.name.trim(),
          gstin: orNull(draft.gstin.toUpperCase()),
          country: draft.country.trim().toUpperCase(),
          currency: draft.currency.trim().toUpperCase(),
          contact_name: orNull(draft.contactName),
          contact_phone: orNull(draft.contactPhone),
          contact_email: orNull(draft.contactEmail),
          payment_terms_days: Number(draft.terms),
          warranty_days: Number(draft.warranty),
        })
      }
      onAdded={props.onAdded}
      onCancel={props.onCancel}
    >
      <div className={form.fields}>
        {BOXES.map(([field, box, width, most]) => (
          <Field key={field} label={formWords[field]} className={form.field} box={box}>
            {(control) => (
              <TextInput
                {...control}
                width={width}
                maxLength={most}
                value={draft[field]}
                onChange={(event) => {
                  setDraft({ ...draft, [field]: event.target.value });
                }}
              />
            )}
          </Field>
        ))}
      </div>
    </AddForm>
  );
}
