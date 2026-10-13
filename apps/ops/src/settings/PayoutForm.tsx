// A month's payment to a partner, as Finance made it from the payout tool (docs/decisions/0124-partner-statements.md):
// its boxes, then the payment as it will be recorded, and only the second press records it
// (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).

import { DateInput, Field, NumberInput, TextInput } from "@maneman/ui/Field";
import { shortDate } from "@maneman/web-kit/dates";
import { paiseFromRupees, rupees } from "@maneman/web-kit/money";
import { useState } from "react";
import { api, type PartnerStatement, type PartnerStatements } from "../api.ts";
import { partnerCommission } from "../content/partner-commission.ts";
import { SettingForm, sentOf, useSteps } from "./SettingForm.tsx";
import styles from "../components/forms.module.css";

const { form, check, errors } = partnerCommission;

interface Draft {
  readonly amount: string;
  readonly paidOn: string;
  readonly reference: string;
}

function PayoutFields(props: { draft: Draft; month: string; today: string; edit: (change: Partial<Draft>) => void }) {
  const { draft, edit } = props;
  return (
    <div className={styles.fields}>
      <Field label={form.amount} className={styles.field}>
        {(control) => (
          <NumberInput
            {...control}
            className={styles.amountBox}
            inputMode="decimal"
            min={0}
            value={draft.amount}
            onChange={(event) => {
              edit({ amount: event.target.value });
            }}
          />
        )}
      </Field>
      <Field label={form.paidOn} className={styles.field}>
        {(control) => (
          <DateInput
            {...control}
            className={styles.dateBox}
            min={`${props.month}-01`}
            max={props.today}
            value={draft.paidOn}
            onChange={(event) => {
              edit({ paidOn: event.target.value });
            }}
          />
        )}
      </Field>
      <Field label={form.reference} className={styles.field}>
        {(control) => (
          <TextInput
            {...control}
            className={styles.areaBox}
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
    amount: String(Math.max(statement.due, 0) / 100),
    paidOn: props.today,
    reference: "",
  });
  const amount = paiseFromRupees(draft.amount);
  const reference = draft.reference.trim();
  const steps = useSteps(
    async () =>
      sentOf(
        await api.recordPartnerPayout(statement.channel_id, { month, amount, paid_on: draft.paidOn, reference }),
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
      title={form.title(statement.name, props.monthName)}
      steps={steps}
      ready={ready}
      errors={errors}
      onCancel={props.onCancel}
      checking={
        <>
          <p className={styles.checkLine}>{check.line(rupees(amount), shortDate(draft.paidOn), reference)}</p>
          {amount < statement.due && <p className={styles.checkWarning}>{check.short(rupees(statement.due))}</p>}
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
