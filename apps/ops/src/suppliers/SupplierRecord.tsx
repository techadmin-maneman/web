// A supplier's record (docs/decisions/0165-suppliers.md): its name, GST number, country and currency, a contact, and
// its payment terms and warranty, each changed where it reads; retiring or restoring it at the foot; and beneath, what
// it supplies.

import { Button } from "@maneman/ui/Button";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { errorText } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { DeleteAction } from "../components/DeleteAction.tsx";
import { figureOrNone, FigureRow, ReadRow, TextRow } from "../components/RecordRows.tsx";
import { Refusal } from "../components/Refusal.tsx";
import form from "../components/forms.module.css";
import { settings } from "../content/settings.ts";
import { useAccess } from "../lib/access.ts";
import { SupplierItems } from "./SupplierItems.tsx";
import { suppliersApi, type Supplier, type SupplierFields, type Suppliers } from "./suppliers-api.ts";

const copy = settings.suppliers;
const rows = copy.rows;

interface Props {
  readonly supplier: Supplier;
  readonly suppliers: Suppliers;
  readonly onSaved: (suppliers: Suppliers) => void;
}

/** The supplier as the API takes it, each field as it stands. */
const fieldsOf = (supplier: Supplier): SupplierFields => ({
  name: supplier.name,
  gstin: supplier.gstin,
  country: supplier.country,
  currency: supplier.currency,
  contact_name: supplier.contact_name,
  contact_phone: supplier.contact_phone,
  contact_email: supplier.contact_email,
  payment_terms_days: supplier.payment_terms_days,
  warranty_days: supplier.warranty_days,
});

const orNull = (text: string) => (text.trim() === "" ? null : text.trim());

/** The fields written in capitals, and those a supplier cannot be without; any other may be emptied. */
const CODES = new Set(["gstin", "country", "currency"]);
const NEEDED = new Set(["name", "country", "currency"]);

/** Retiring takes it off new orders, asked once; restoring puts it back on one press. */
function SupplierFoot({ supplier, onSaved }: Omit<Props, "suppliers">) {
  const [busy, once] = useOneAtATime();
  const [refused, setRefused] = useState<string | null>(null);
  if (!useAccess().mayCall("POST /api/suppliers/{id}/retire")) return null;
  const restore = () =>
    once(async () => {
      setRefused(null);
      const answer = await suppliersApi.restoreSupplier(supplier.id);
      if (!answer.ok) {
        setRefused(errorText(copy.errors, answer));
        return;
      }
      onSaved(answer.body);
    });
  return (
    <div className={form.recordFoot}>
      {supplier.retired_at === null ? (
        <DeleteAction
          name={supplier.name}
          tone="danger"
          words={copy.retiring}
          send={() => suppliersApi.retireSupplier(supplier.id)}
          refusal={(code) => errorText(copy.errors, { code })}
          onDeleted={onSaved}
        />
      ) : (
        <Button
          variant="outline"
          size="small"
          narrow
          busy={busy}
          aria-label={copy.restoreLabel(supplier.name)}
          onClick={() => void restore()}
        >
          {copy.restore}
        </Button>
      )}
      {refused !== null && <Refusal said={refused} />}
    </div>
  );
}

export function SupplierRecord(props: Props) {
  const { supplier, onSaved } = props;
  const mayChange = useAccess().mayCall("POST /api/suppliers/{id}");
  const save = async (change: Partial<SupplierFields>) => {
    const answer = await suppliersApi.changeSupplier(supplier.id, { ...fieldsOf(supplier), ...change });
    if (!answer.ok) return errorText(copy.errors, answer);
    onSaved(answer.body);
    return null;
  };
  const days = (field: "payment_terms_days" | "warranty_days") => (typed: string) => {
    const figure = figureOrNone(typed);
    return figure === undefined || figure === null ? Promise.resolve(copy.errors[field]) : save({ [field]: figure });
  };
  const words = (
    label: string,
    field: "name" | "gstin" | "country" | "currency" | "contact_name" | "contact_phone" | "contact_email",
    most: number,
    type: "text" | "tel" | "email" = "text",
  ) => (
    <TextRow
      label={label}
      value={supplier[field] ?? ""}
      shown={supplier[field] ?? rows.none}
      maxLength={most}
      type={type}
      mayChange={mayChange}
      save={(typed) => {
        const text = CODES.has(field) ? typed.toUpperCase() : typed;
        return save({ [field]: NEEDED.has(field) ? text.trim() : orNull(text) });
      }}
    />
  );
  return (
    <>
      <div className={form.record}>
        {words(rows.name, "name", 80)}
        {words(rows.gstin, "gstin", 15)}
        {words(rows.country, "country", 2)}
        {words(rows.currency, "currency", 3)}
        {words(rows.contactName, "contact_name", 80)}
        {words(rows.contactPhone, "contact_phone", 16, "tel")}
        {words(rows.contactEmail, "contact_email", 120, "email")}
        <FigureRow
          label={rows.terms}
          value={supplier.payment_terms_days}
          shown={copy.terms(supplier.payment_terms_days)}
          unit={rows.days}
          mayChange={mayChange}
          save={days("payment_terms_days")}
        />
        <FigureRow
          label={rows.warranty}
          value={supplier.warranty_days}
          shown={copy.warranty(supplier.warranty_days)}
          unit={rows.days}
          mayChange={mayChange}
          save={days("warranty_days")}
        />
        <ReadRow label={rows.status} value={supplier.retired_at === null ? copy.active : copy.retired} />
      </div>
      <SupplierFoot supplier={supplier} onSaved={onSaved} />
      <SupplierItems suppliers={props.suppliers} supplier={supplier} onSaved={onSaved} />
    </>
  );
}
