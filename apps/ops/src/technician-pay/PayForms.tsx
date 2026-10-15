// The Technician pay page's forms (docs/decisions/0122-technician-pay-per-visit.md): a grade added or renamed, a
// grade's rate for a kind of visit from a day, and a technician's grade. Each goes as every setting does: its boxes,
// then what it is now beside what it will be, and only the second press sends it
// (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).

import { CheckLine } from "../components/CheckPanel.tsx";
import { Checkbox, DateInput, Field, NumberInput, Select, TextInput } from "@maneman/ui/Field";
import { shortDate } from "@maneman/web-kit/dates";
import { paiseFromRupees, rupees } from "@maneman/web-kit/money";
import { useState } from "react";
import { type PayKind, type TechnicianPay } from "../api.ts";
import { technicianPay } from "../content/technician-pay.ts";
import { rateNow } from "./pay-rates.ts";
import { SettingForm, sentOf, useSteps } from "../settings/index.ts";
import form from "../components/forms.module.css";
import { technicianPayApi } from "./technician-pay-api.ts";

const { form: formWords, check, errors } = technicianPay;

type Grade = TechnicianPay["grades"][number];
type PayTechnician = TechnicianPay["technicians"][number];

interface FormProps {
  readonly onDone: (pay: TechnicianPay) => void;
  readonly onCancel: () => void;
}

/** A grade's name, typed. */
function NameField({ name, onName }: { name: string; onName: (name: string) => void }) {
  return (
    <div className={form.fields}>
      <Field label={formWords.name} className={form.field} box="name">
        {(control) => (
          <TextInput
            {...control}
            className={form.areaBox}
            maxLength={40}
            value={name}
            onChange={(event) => {
              onName(event.target.value);
            }}
          />
        )}
      </Field>
    </div>
  );
}

export function AddGradeForm({ onDone, onCancel }: FormProps) {
  const [name, setName] = useState("");
  const steps = useSteps(
    async () => sentOf(await technicianPayApi.addPayGrade(name.trim()), (pay) => ({ pay })),
    (sent) => {
      onDone(sent.pay);
    },
  );
  return (
    <SettingForm
      title={formWords.addTitle}
      steps={steps}
      ready={name.trim() !== ""}
      errors={errors}
      onCancel={onCancel}
      boxes={["name"]}
      checking={<CheckLine>{check.add(name.trim())}</CheckLine>}
    >
      <NameField
        name={name}
        onName={(typed) => {
          setName(typed);
          steps.edit();
        }}
      />
    </SettingForm>
  );
}

export function RenameGradeForm({ grade, onDone, onCancel }: FormProps & { readonly grade: Grade }) {
  const [name, setName] = useState(grade.name);
  const steps = useSteps(
    async () => sentOf(await technicianPayApi.renamePayGrade(grade.id, name.trim()), (pay) => ({ pay })),
    (sent) => {
      onDone(sent.pay);
    },
  );
  return (
    <SettingForm
      title={formWords.renameTitle(grade.name)}
      steps={steps}
      ready={name.trim() !== "" && name.trim() !== grade.name}
      errors={errors}
      onCancel={onCancel}
      boxes={["name"]}
      checking={<CheckLine>{check.rename(grade.name, name.trim())}</CheckLine>}
    >
      <NameField
        name={name}
        onName={(typed) => {
          setName(typed);
          steps.edit();
        }}
      />
    </SettingForm>
  );
}

interface RateDraft {
  readonly kind: PayKind;
  /** "" for every city. */
  readonly city: string;
  readonly amount: string;
  readonly none: boolean;
  readonly from: string;
}

interface DraftProps {
  readonly pay: TechnicianPay;
  readonly draft: RateDraft;
  readonly edit: (change: Partial<RateDraft>) => void;
}

/** Which rate: the kind of visit, and every city or one. */
function RateWhere({ pay, draft, edit }: DraftProps) {
  return (
    <>
      <Field label={formWords.kind} className={form.field} box="kind">
        {(control) => (
          <Select
            {...control}
            className={form.choiceBox}
            value={draft.kind}
            onChange={(event) => {
              edit({ kind: pay.kinds.find((kind) => kind === event.target.value) ?? draft.kind });
            }}
          >
            {pay.kinds.map((kind) => (
              <option key={kind} value={kind}>
                {technicianPay.kinds[kind]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={formWords.city} className={form.field} box="city">
        {(control) => (
          <Select
            {...control}
            className={form.choiceBox}
            value={draft.city}
            onChange={(event) => {
              edit({ city: event.target.value });
            }}
          >
            <option value="">{technicianPay.rates.everyCity}</option>
            {pay.cities.map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </>
  );
}

/** The rate's boxes: which rate, the amount or none, and the day it starts. */
function RateFields({ pay, draft, edit }: DraftProps) {
  return (
    <>
      <div className={form.fields}>
        <RateWhere pay={pay} draft={draft} edit={edit} />
        <Field label={formWords.amount} className={form.field} box="amount">
          {(control) => (
            <NumberInput
              {...control}
              className={form.amountBox}
              inputMode="numeric"
              step={1}
              min={0}
              max={pay.max_amount / 100}
              disabled={draft.none}
              value={draft.amount}
              onChange={(event) => {
                edit({ amount: event.target.value });
              }}
            />
          )}
        </Field>
        <Field
          box="from"
          label={formWords.from}
          className={form.field}
          error={draft.from !== "" && draft.from < pay.today ? technicianPay.errors.from : undefined}
        >
          {(control) => (
            <DateInput
              {...control}
              className={form.dateBox}
              min={pay.today}
              value={draft.from}
              onChange={(event) => {
                edit({ from: event.target.value });
              }}
            />
          )}
        </Field>
      </div>
      <div className={form.fields}>
        <Checkbox
          label={formWords.none}
          checked={draft.none}
          onChange={(event) => {
            edit({ none: event.currentTarget.checked });
          }}
        />
      </div>
    </>
  );
}

/** What a city left with no rate of its own pays: every city's, which stands in; every city's own, nothing. */
const noneFor = (city: string | null) => (city === null ? check.nothing : check.everyCitys);

export function SetRateForm(props: FormProps & { readonly grade: Grade; readonly pay: TechnicianPay; city: string }) {
  const { grade, pay } = props;
  const [draft, setDraft] = useState<RateDraft>({
    kind: "service",
    city: props.city,
    amount: "",
    none: false,
    from: pay.today,
  });
  const city = draft.city === "" ? null : draft.city;
  const amount = draft.none ? null : paiseFromRupees(draft.amount);
  const amountOk = amount === null || (draft.amount.trim() !== "" && amount >= 0 && amount <= pay.max_amount);
  const steps = useSteps(
    async () =>
      sentOf(
        await technicianPayApi.setPayRate({ grade_id: grade.id, city, kind: draft.kind, amount, from: draft.from }),
        (body) => ({
          pay: body,
        }),
      ),
    (sent) => {
      props.onDone(sent.pay);
    },
  );
  const edit = (change: Partial<RateDraft>) => {
    setDraft({ ...draft, ...change });
    steps.edit();
  };
  const where = check.where(grade.name, technicianPay.kinds[draft.kind], city ?? technicianPay.rates.everyCity);
  const was = rateNow(pay, { grade: grade.id, kind: draft.kind, city });
  const now = amount === null ? noneFor(city) : rupees(amount);
  return (
    <SettingForm
      title={formWords.rateTitle(grade.name)}
      steps={steps}
      ready={amountOk && draft.from >= pay.today}
      errors={{ ...errors, amount: technicianPay.amountUpTo(rupees(pay.max_amount)) }}
      onCancel={props.onCancel}
      boxes={["kind", "city", "amount", "from"]}
      checking={<CheckLine>{check.rate(where, was, now, shortDate(draft.from))}</CheckLine>}
    >
      <RateFields pay={pay} draft={draft} edit={edit} />
    </SettingForm>
  );
}

export function GradeOfForm(props: FormProps & { readonly technician: PayTechnician; readonly pay: TechnicianPay }) {
  const { technician, pay } = props;
  const [grade, setGrade] = useState(technician.grade_id ?? "");
  const nameOf = (id: string | null) =>
    pay.grades.find((each) => each.id === id)?.name ?? technicianPay.technicians.noGrade;
  const steps = useSteps(
    async () =>
      sentOf(await technicianPayApi.setPayGradeOf(technician.id, grade === "" ? null : grade), (body) => ({
        pay: body,
      })),
    (sent) => {
      props.onDone(sent.pay);
    },
  );
  return (
    <SettingForm
      title={formWords.gradeTitle(technician.name)}
      steps={steps}
      ready={grade !== (technician.grade_id ?? "")}
      errors={errors}
      onCancel={props.onCancel}
      boxes={["grade_id"]}
      checking={<CheckLine>{check.grade(technician.name, nameOf(technician.grade_id), nameOf(grade))}</CheckLine>}
    >
      <div className={form.fields}>
        <Field label={formWords.grade} className={form.field} box="grade_id">
          {(control) => (
            <Select
              {...control}
              className={form.choiceBox}
              value={grade}
              onChange={(event) => {
                setGrade(event.target.value);
                steps.edit();
              }}
            >
              <option value="">{technicianPay.technicians.noGrade}</option>
              {pay.grades.map((each) => (
                <option key={each.id} value={each.id}>
                  {each.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
    </SettingForm>
  );
}
