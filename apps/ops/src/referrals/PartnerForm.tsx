// A partner added (docs/decisions/0123-partner-referral-channels.md): its name, what its friend gets, its commission
// per fit, and a discount code if any. Once added, each changes where it reads in its record.

import { Field, NumberInput, TextInput, type BoxWidth } from "@maneman/ui/Field";
import { paiseFromRupees, rupees } from "@maneman/web-kit/money";
import { useState } from "react";
import { type Partners } from "../api.ts";
import { AddForm } from "../components/AddForm.tsx";
import form from "../components/forms.module.css";
import { partners as copy } from "../content/partners.ts";
import { referralsApi } from "./referrals-api.ts";

const formWords = copy.form;

interface Draft {
  readonly name: string;
  readonly friendVisits: string;
  readonly validDays: string;
  readonly commission: string;
  readonly discountCode: string;
}

const BLANK: Draft = { name: "", friendVisits: "2", validDays: "365", commission: "", discountCode: "" };

/** Each box: what it fills, the name the API refuses it by, how wide it is, and whether it holds a figure. */
const BOXES: readonly (readonly [keyof Draft, string, BoxWidth, boolean])[] = [
  ["name", "name", "area", false],
  ["friendVisits", "friend_visits", "figure", true],
  ["validDays", "valid_days", "figure", true],
  ["commission", "commission", "amount", true],
  ["discountCode", "discount_code", "choice", false],
];

export function AddPartner(props: {
  readonly limits: Partners["limits"];
  readonly onAdded: (list: Partners) => void;
  readonly onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(BLANK);
  return (
    <AddForm
      title={formWords.addTitle}
      words={formWords}
      errors={{ ...copy.errors, commission: copy.commissionUpTo(rupees(props.limits.max_commission)) }}
      boxes={BOXES.map(([, box]) => box)}
      send={() =>
        referralsApi.addPartner({
          name: draft.name.trim(),
          friend_visits: Number(draft.friendVisits),
          valid_days: Number(draft.validDays),
          commission: paiseFromRupees(draft.commission === "" ? "0" : draft.commission),
          discount_code: draft.discountCode.trim() === "" ? null : draft.discountCode.trim().toUpperCase(),
        })
      }
      onAdded={props.onAdded}
      onCancel={props.onCancel}
    >
      <div className={form.fields}>
        {BOXES.map(([field, box, width, figure]) => (
          <Field key={field} label={formWords[field]} className={form.field} box={box}>
            {(control) => {
              const typed = (event: { target: { value: string } }) => {
                setDraft({ ...draft, [field]: event.target.value });
              };
              return figure ? (
                <NumberInput {...control} width={width} inputMode="numeric" value={draft[field]} onChange={typed} />
              ) : (
                <TextInput {...control} width={width} maxLength={60} value={draft[field]} onChange={typed} />
              );
            }}
          </Field>
        ))}
      </div>
    </AddForm>
  );
}
