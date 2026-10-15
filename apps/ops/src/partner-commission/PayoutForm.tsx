// A month's payment to a partner, as Finance made it from the payout tool (docs/decisions/0124-partner-statements.md):
// its boxes, then the payment as it will be recorded, and only the second press records it
// (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).

import { CheckLine, CheckWarning } from "../components/CheckPanel.tsx";
import { DateInput, Field, NumberInput, TextInput } from "@maneman/ui/Field";
import { shortDate } from "@maneman/web-kit/dates";
import { paiseFromRupees, rupees, rupeesTyped } from "@maneman/web-kit/money";
import { useState } from "react";
import { type PartnerStatement, type PartnerStatements } from "../api.ts";
import { partnerCommission } from "../content/partner-commission.ts";
import { SettingForm, sentOf, useSteps } from "../settings/index.ts";
import form from "../components/forms.module.css";
import { partnerCommissionApi } from "./partner-commission-api.ts";

const { form: formWords, check, errors } = partnerCommission;

interface Draft {
  readonly amount: string;
  readonly paidOn: string;
  readonly reference: string;
}

function PayoutFields(props: { draft: Draft; month: string; today: string; edit: (change: Partial<Draft>) => void }) {
  const { draft, edit } = props;
  return (
    <div className={form.fields}>
      <Field label={formWords.amount} className={form.field} box="amount">
        {(control) => (
          <NumberInput
            {...control}
            width="amount"
            inputMode="decimal"
            min={0}
            value={draft.amount}
            onChange={(event) => {
              edit({ amount: event.target.value });
            }}
          />
        )}
      </Field>
      <Field label={formWords.paidOn} className={form.field} box="paid_on">
        {(control) => (
          <DateInput
            {...control}
            width="date"
            min={`${props.month}-01`}
            max={props.today}
            value={draft.paidOn}
            onChange={(event) => {
              edit({ paidOn: event.target.value });
            }}
          />
        )}
      </Field>
      <Field label={formWords.reference} className={form.field} box="reference">
        {(control) => (
          <TextInput
            {...control}
            width="area"
            maxLength={60}
            value={draft.reference}
            onChange={(event) => {
              edit({ reference: event.target.value });
            }}
          />
        )}
      </Field>
    </div>
  );
}

export function PayoutForm(props: {
  readonly statement: PartnerStatement;
  readonly month: string;
  readonly monthName: string;
  readonly today: string;
  readonly maxAmount: number;
  readonly onDone: (statements: PartnerStatements) => void;
  readonly onCancel: () => void;
}) {
  const { statement, month } = props;
  const [draft, setDraft] = useState<Draft>({
    amount: rupeesTyped(Math.max(statement.due, 0)),
    paidOn: props.today,
    reference: "",
  });
  const amount = paiseFromRupees(draft.amount);
  const reference = draft.reference.trim();
  const steps = useSteps(
    async () =>
      sentOf(
        await partnerCommissionApi.recordPartnerPayout(statement.channel_id, {
          month,
          amount,
          paid_on: draft.paidOn,
          reference,
        }),
        (body) => ({ statements: body }),
      ),
    (sent) => {
      props.onDone(sent.statements);
    },
  );
  const ready =
    draft.amount.trim() !== "" &&
    amount >= 0 &&
    amount <= props.maxAmount &&
    draft.paidOn >= `${month}-01` &&
    draft.paidOn <= props.today &&
    reference !== "";
  return (
    <SettingForm
      title={formWords.title(statement.name, props.monthName)}
      steps={steps}
      ready={ready}
      errors={{ ...errors, amount: partnerCommission.amountUpTo(rupees(props.maxAmount)) }}
      onCancel={props.onCancel}
      boxes={["amount", "paid_on", "reference"]}
      checking={
        <>
          <CheckLine>{check.line(rupees(amount), shortDate(draft.paidOn), reference)}</CheckLine>
          {amount < statement.due && <CheckWarning>{check.short(rupees(statement.due))}</CheckWarning>}
        </>
      }
    >
      <PayoutFields
        draft={draft}
        month={month}
        today={props.today}
        edit={(change) => {
          setDraft({ ...draft, ...change });
          steps.edit();
        }}
      />
    </SettingForm>
  );
}
