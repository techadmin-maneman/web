// What each grade is paid for each kind of visit, for every city or one, and the form that sets a rate from a date
// (docs/decisions/0122-technician-pay-per-visit.md). A city's own rate stands in for every city's there; where it has
// none, every city's shows, marked.

import { Button } from "@maneman/ui/Button";
import { Panel } from "@maneman/ui/Panel";
import { shortDate } from "@maneman/web-kit/dates";
import { paiseFromRupees, rupees } from "@maneman/web-kit/money";
import { errorText } from "@maneman/web-kit/refusal";
import { useState, type InputHTMLAttributes } from "react";
import { api, type PayKind, type PayRate, type TechnicianPay } from "../api.ts";
import { technicianPay } from "../content/technician-pay.ts";
import { usePaySend } from "./pay-send.ts";
import styles from "../components/forms.module.css";

const copy = technicianPay.rates;

/** A city of "" is every city. */
const cityOrEvery = (city: string): string | null => (city === "" ? null : city);

interface Cell {
  readonly grade: string;
  readonly kind: PayKind;
  readonly city: string | null;
}

/** The rate in force on `today` for one cell, if any is set. */
const rateOf = (rates: readonly PayRate[], cell: Cell, today: string) =>
  rates.find(
    (r) => r.grade_id === cell.grade && r.kind === cell.kind && r.city === cell.city && r.effective_from <= today,
  );

/** What a cell says: the rate in force today for the city shown, and each one set to start later. */
function cellLines(pay: TechnicianPay, grade: string, kind: PayKind, city: string | null): string[] {
  const own = rateOf(pay.rates, { grade, kind, city }, pay.today);
  const every = city === null ? undefined : rateOf(pay.rates, { grade, kind, city: null }, pay.today);
  let now: string = copy.none;
  if (own !== undefined && own.amount !== null) now = rupees(own.amount);
  else if (every !== undefined && every.amount !== null) now = copy.inherited(rupees(every.amount));
  const later = pay.rates
    .filter((r) => r.grade_id === grade && r.kind === kind && r.city === city && r.effective_from > pay.today)
    .map((r) =>
      r.amount === null
        ? copy.laterNone(shortDate(r.effective_from))
        : copy.later(rupees(r.amount), shortDate(r.effective_from)),
    );
  return [now, ...later];
}

function RateTable({ pay, city }: { pay: TechnicianPay; city: string | null }) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">{copy.grade}</th>
          {pay.kinds.map((kind) => (
            <th key={kind} scope="col">
              {technicianPay.kinds[kind]}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {pay.grades.map((grade) => (
          <tr key={grade.id}>
            <th scope="row">{grade.name}</th>
            {pay.kinds.map((kind) => (
              <td key={kind} className={styles.figure}>
                {cellLines(pay, grade.id, kind, city).map((line) => (
                  <span key={line} className={styles.inline}>
                    {line}
                  </span>
                ))}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface Draft {
  readonly grade: string;
  readonly kind: PayKind;
  readonly city: string;
  readonly amount: string;
  readonly clear: boolean;
  readonly from: string;
}

function Select(props: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly (readonly [string, string])[];
}) {
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor={props.id}>
        {props.label}
      </label>
      <select
        className={styles.select}
        id={props.id}
        value={props.value}
        onChange={(event) => {
          props.onChange(event.target.value);
        }}
      >
        {props.options.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** A labelled input of the form's: the amount, or the first day. */
function Input({
  label,
  onChange,
  ...input
}: Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> & {
  id: string;
  label: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor={input.id}>
        {label}
      </label>
      <input
        {...input}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </div>
  );
}

function RateFields({
  pay,
  draft,
  edit,
}: {
  pay: TechnicianPay;
  draft: Draft;
  edit: (change: Partial<Draft>) => void;
}) {
  const words = copy.set;
  return (
    <>
      <div className={styles.fields}>
        <Select
          id="pay-rate-grade"
          label={words.grade}
          value={draft.grade}
          onChange={(grade) => {
            edit({ grade });
          }}
          options={pay.grades.map((g) => [g.id, g.name] as const)}
        />
        <Select
          id="pay-rate-kind"
          label={words.kind}
          value={draft.kind}
          onChange={(kind) => {
            edit({ kind: pay.kinds.find((each) => each === kind) ?? draft.kind });
          }}
          options={pay.kinds.map((k) => [k, technicianPay.kinds[k]] as const)}
        />
        <Select
          id="pay-rate-city"
          label={words.city}
          value={draft.city}
          onChange={(city) => {
            edit({ city });
          }}
          options={[["", copy.everyCity] as const, ...pay.cities.map((c) => [c, c] as const)]}
        />
        <Input
          id="pay-rate-amount"
          label={words.amount}
          className={styles.number}
          type="number"
          min="0"
          step={1}
          disabled={draft.clear}
          value={draft.amount}
          onChange={(amount) => {
            edit({ amount });
          }}
        />
        <Input
          id="pay-rate-from"
          label={words.from}
          className={styles.date}
          type="date"
          min={pay.today}
          value={draft.from}
          onChange={(from) => {
            edit({ from });
          }}
        />
      </div>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={draft.clear}
          onChange={(event) => {
            edit({ clear: event.target.checked });
          }}
        />{" "}
        {words.clear}
      </label>
    </>
  );
}

function SetRate({ pay, onChanged }: { pay: TechnicianPay; onChanged: (pay: TechnicianPay) => void }) {
  const words = copy.set;
  const [draft, setDraft] = useState<Draft>({
    grade: pay.grades[0]?.id ?? "",
    kind: "service",
    city: "",
    amount: "",
    clear: false,
    from: pay.today,
  });
  const [saved, setSaved] = useState(false);
  const { sending, failure, send } = usePaySend(onChanged);
  const edit = (change: Partial<Draft>) => {
    setDraft({ ...draft, ...change });
    setSaved(false);
  };
  const amount = draft.clear ? null : paiseFromRupees(draft.amount);
  const ready =
    draft.grade !== "" &&
    draft.from !== "" &&
    (amount === null || (Number.isInteger(amount) && amount >= 0 && amount <= pay.max_amount && draft.amount !== ""));
  const save = () =>
    void send(() =>
      api.setPayRate({
        grade_id: draft.grade,
        city: cityOrEvery(draft.city),
        kind: draft.kind,
        amount,
        from: draft.from,
      }),
    ).then(setSaved);

  return (
    <form
      className={styles.group}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <h3 className={styles.ruleTitle}>{words.title}</h3>
      <RateFields pay={pay} draft={draft} edit={edit} />
      <div className={styles.actions}>
        <Button type="submit" variant="primary" size="small" disabled={!ready || sending}>
          {sending ? words.saving : words.save}
        </Button>
      </div>
      {saved && (
        <p className={styles.saved} role="status">
          {words.saved}
        </p>
      )}
      {failure !== null && (
        <p className={styles.error} role="alert">
          {errorText(copy.errors, failure)}
        </p>
      )}
    </form>
  );
}

export function PayRates(props: { pay: TechnicianPay; maySet: boolean; onChanged: (pay: TechnicianPay) => void }) {
  const [showing, setShowing] = useState("");
  const { pay } = props;
  return (
    <Panel titleId="pay-rates" title={copy.title} className={styles.panel}>
      <Select
        id="pay-rates-city"
        label={copy.showing}
        value={showing}
        onChange={setShowing}
        options={[["", copy.everyCity] as const, ...pay.cities.map((c) => [c, c] as const)]}
      />
      <RateTable pay={pay} city={cityOrEvery(showing)} />
      {props.maySet && <SetRate pay={pay} onChanged={props.onChanged} />}
    </Panel>
  );
}
