// A pay grade added, and a grade's record (docs/decisions/0122-technician-pay-per-visit.md): its name, and what it
// pays for each kind of visit in the city the page shows, each changed where it reads. A rate asks its day in the same
// row, today to begin with; an empty amount is no rate of its own from that day. A grade no technician holds is
// deleted at the foot.

import { EditableRow } from "@maneman/ui/EditableRow";
import { DateInput, Field, NumberInput, TextInput } from "@maneman/ui/Field";
import { paiseFromRupees, rupees } from "@maneman/web-kit/money";
import { errorText } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { type PayKind, type TechnicianPay } from "../api.ts";
import { AddForm } from "../components/AddForm.tsx";
import { DeleteAction } from "../components/DeleteAction.tsx";
import { TextRow } from "../components/RecordRows.tsx";
import form from "../components/forms.module.css";
import { EDITING } from "../content/common.ts";
import { technicianPay } from "../content/technician-pay.ts";
import { useAccess } from "../lib/access.ts";
import { rateNow, ratesLater } from "./pay-rates.ts";
import styles from "./pay-rates.module.css";
import { technicianPayApi } from "./technician-pay-api.ts";

const { form: formWords, errors } = technicianPay;
const WHOLE = /^\d{1,7}$/;

type Grade = TechnicianPay["grades"][number];

export function AddGrade(props: { readonly onAdded: (pay: TechnicianPay) => void; readonly onCancel: () => void }) {
  const [name, setName] = useState("");
  return (
    <AddForm
      title={formWords.addTitle}
      words={formWords}
      errors={errors}
      boxes={["name"]}
      send={() => technicianPayApi.addPayGrade(name.trim())}
      onAdded={props.onAdded}
      onCancel={props.onCancel}
    >
      <div className={form.fields}>
        <Field label={formWords.name} className={form.field} box="name">
          {(control) => (
            <TextInput
              {...control}
              width="area"
              maxLength={40}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          )}
        </Field>
      </div>
    </AddForm>
  );
}

interface RateDraft {
  /** Whole rupees as typed; empty for no rate of its own. */
  readonly amount: string;
  readonly from: string;
}

/** What the grade pays for one kind of visit in the city shown, and the rates set to start later. */
function RateRow(props: {
  readonly pay: TechnicianPay;
  readonly grade: Grade;
  readonly kind: PayKind;
  readonly city: string | null;
  readonly onSaved: (pay: TechnicianPay) => void;
}) {
  const { pay, grade, kind, city } = props;
  const cell = { grade: grade.id, kind, city };
  const own = pay.rates.find(
    (rate) => rate.grade_id === grade.id && rate.kind === kind && rate.city === city && rate.effective_from <= pay.today,
  );
  return (
    <EditableRow<RateDraft>
      label={technicianPay.kinds[kind]}
      words={EDITING}
      mayChange={useAccess().mayCall("POST /api/technician-pay/rates")}
      value={[rateNow(pay, cell), ...ratesLater(pay, cell)].join(" · ")}
      start={() => ({ amount: own?.amount === undefined || own.amount === null ? "" : String(own.amount / 100), from: pay.today })}
      save={async (draft) => {
        const typed = draft.amount.trim();
        const amount = typed === "" ? null : paiseFromRupees(typed);
        if ((typed !== "" && !WHOLE.test(typed)) || (amount ?? 0) > pay.max_amount) {
          return technicianPay.amountUpTo(rupees(pay.max_amount));
        }
        if (draft.from < pay.today) return errors.from;
        const answer = await technicianPayApi.setPayRate({ grade_id: grade.id, city, kind, amount, from: draft.from });
        if (!answer.ok) return errorText(errors, answer);
        props.onSaved(answer.body);
        return null;
      }}
    >
      {(control, draft, edit) => (
        <>
          <NumberInput
            {...control}
            type="text"
            width="amount"
            inputMode="numeric"
            value={draft.amount}
            onChange={(event) => {
              edit({ ...draft, amount: event.target.value });
            }}
          />
          <DateInput
            width="date"
            aria-label={formWords.from}
            min={pay.today}
            value={draft.from}
            onChange={(event) => {
              edit({ ...draft, from: event.target.value });
            }}
          />
        </>
      )}
    </EditableRow>
  );
}

export function GradeRecord(props: {
  readonly pay: TechnicianPay;
  readonly grade: Grade;
  /** The city the page shows, or null for every city. */
  readonly city: string | null;
  readonly onSaved: (pay: TechnicianPay) => void;
  readonly onDeleted: (pay: TechnicianPay) => void;
}) {
  const { pay, grade, city, onSaved } = props;
  const access = useAccess();
  const mayChange = access.mayCall("POST /api/technician-pay/grades");
  return (
    <>
      <div className={form.record}>
        <TextRow
          label={formWords.name}
          value={grade.name}
          maxLength={40}
          mayChange={mayChange}
          save={async (typed) => {
            const answer = await technicianPayApi.renamePayGrade(grade.id, typed.trim());
            if (!answer.ok) return errorText(errors, answer);
            onSaved(answer.body);
            return null;
          }}
        />
      </div>
      <h3 className={styles.ratesTitle}>{formWords.ratesIn(city)}</h3>
      <div className={form.record}>
        {pay.kinds.map((kind) => (
          <RateRow key={kind} pay={pay} grade={grade} kind={kind} city={city} onSaved={onSaved} />
        ))}
      </div>
      {mayChange && grade.technicians === 0 && (
        <div className={form.recordFoot}>
          <DeleteAction
            name={grade.name}
            send={() => technicianPayApi.deletePayGrade(grade.id)}
            refusal={(refused) =>
              refused === "in_use" ? technicianPay.rates.inUse : errorText(errors, { code: refused })
            }
            onDeleted={props.onDeleted}
          />
        </div>
      )}
    </>
  );
}
