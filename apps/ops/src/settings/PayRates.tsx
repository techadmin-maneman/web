// What each grade is paid for each kind of visit, for every city or one (docs/decisions/0122-technician-pay-per-visit.md).
// A city with no rate of its own shows every city's, marked; a rate set to start later shows beneath the one in force.
// Each grade's row sets a rate, renames the grade, or, while no technician holds it, deletes it.

import { InlineMessage } from "@maneman/ui/InlineMessage";
import { Button, RowButton } from "@maneman/ui/Button";
import { Field, Select } from "@maneman/ui/Field";
import { Panel } from "@maneman/ui/Panel";
import { Table } from "@maneman/ui/Table";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { classes } from "@maneman/ui/classes";
import { errorText } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { api, type TechnicianPay } from "../api.ts";
import { DeleteAction } from "../components/DeleteAction.tsx";
import { technicianPay } from "../content/technician-pay.ts";
import { AddGradeForm, RenameGradeForm, SetRateForm } from "./PayForms.tsx";
import { rateNow, ratesLater } from "./pay-rates.ts";
import form from "../components/forms.module.css";
import styles from "./technician-pay.module.css";

const copy = technicianPay.rates;

type Grade = TechnicianPay["grades"][number];

/** What is open beneath a grade's row. */
type Acting = { readonly id: string; readonly kind: "rate" | "rename" | "delete" } | null;

/** Which row actions the person's access reaches. */
interface May {
  readonly grades: boolean;
  readonly rates: boolean;
}

interface RowProps {
  readonly pay: TechnicianPay;
  /** "" for every city. */
  readonly city: string;
  readonly acting: Acting;
  readonly may: May;
  readonly onAct: (acting: Acting) => void;
  readonly onDone: (pay: TechnicianPay, said: string) => void;
}

/** A grade's row actions; Delete only while no technician holds it. */
function RateActions({ grade, acting, may, onAct }: { grade: Grade } & Pick<RowProps, "acting" | "may" | "onAct">) {
  const actions: readonly (readonly [boolean, NonNullable<Acting>["kind"], string, string])[] = [
    [may.rates, "rate", copy.setRate, copy.setRateLabel(grade.name)],
    [may.grades, "rename", copy.rename, copy.renameLabel(grade.name)],
    [may.grades && grade.technicians === 0, "delete", copy.delete, copy.deleteLabel(grade.name)],
  ];
  return (
    <td className={styles.actions}>
      {actions
        .filter(([shown]) => shown)
        .map(([, kind, words, label]) => (
          <RowButton
            key={kind}
            className={form.inline}
            aria-label={label}
            disabled={acting !== null}
            onClick={() => {
              onAct({ id: grade.id, kind });
            }}
          >
            {words}
          </RowButton>
        ))}
    </td>
  );
}

/** Beneath a grade's row, what its action opened. */
function RateActingRow({ grade, span, ...row }: { grade: Grade; span: number } & RowProps) {
  const { acting, onAct, onDone } = row;
  if (acting?.id !== grade.id) return null;
  const cancel = () => {
    onAct(null);
  };
  const saved = (pay: TechnicianPay) => {
    onDone(pay, technicianPay.done.saved);
  };
  return (
    <tr className={styles.acting}>
      <td colSpan={span}>
        {acting.kind === "rate" && (
          <SetRateForm grade={grade} pay={row.pay} city={row.city} onDone={saved} onCancel={cancel} />
        )}
        {acting.kind === "rename" && <RenameGradeForm grade={grade} onDone={saved} onCancel={cancel} />}
        {acting.kind === "delete" && (
          <div className={styles.ask}>
            <DeleteAction
              name={grade.name}
              send={() => api.deletePayGrade(grade.id)}
              refusal={(refused) =>
                refused === "in_use" ? copy.inUse : errorText(technicianPay.errors, { code: refused, fields: [] })
              }
              onDeleted={(pay) => {
                onDone(pay, technicianPay.done.deleted);
              }}
              onCancel={cancel}
            />
          </div>
        )}
      </td>
    </tr>
  );
}

function GradeRows({ grade, ...row }: { grade: Grade } & RowProps) {
  const { pay } = row;
  const city = row.city === "" ? null : row.city;
  return (
    <>
      <tr>
        <th scope="row" className={styles.grade}>
          {grade.name}
        </th>
        <td className={styles.figure}>{grade.technicians}</td>
        {pay.kinds.map((kind) => (
          <td key={kind} className={styles.figure}>
            {rateNow(pay, { grade: grade.id, kind, city })}
            {ratesLater(pay, { grade: grade.id, kind, city }).map((line) => (
              <span key={line} className={styles.later}>
                {line}
              </span>
            ))}
          </td>
        ))}
        <RateActions grade={grade} {...row} />
      </tr>
      <RateActingRow grade={grade} span={pay.kinds.length + 3} {...row} />
    </>
  );
}

function RatesTable(row: RowProps) {
  return (
    <div className={styles.scroll}>
      <Table className={classes(form.table, styles.table, styles.rates)}>
        <thead>
          <tr>
            <th scope="col">{copy.grade}</th>
            <th scope="col" className={styles.figure}>
              {copy.technicians}
            </th>
            {row.pay.kinds.map((kind) => (
              <th key={kind} scope="col" className={styles.figure}>
                {technicianPay.kinds[kind]}
              </th>
            ))}
            <th scope="col">
              <VisuallyHidden>{copy.actions}</VisuallyHidden>
            </th>
          </tr>
        </thead>
        <tbody>
          {row.pay.grades.map((grade) => (
            <GradeRows key={grade.id} grade={grade} {...row} />
          ))}
        </tbody>
      </Table>
    </div>
  );
}

/** The city the rates are shown for: every city's, or one city's with every city's standing in. */
function CityChoice({ pay, city, onCity }: { pay: TechnicianPay; city: string; onCity: (city: string) => void }) {
  return (
    <div className={styles.tools}>
      <Field label={copy.city}>
        {(control) => (
          <Select
            {...control}
            className={form.choiceBox}
            value={city}
            onChange={(event) => {
              onCity(event.target.value);
            }}
          >
            <option value="">{copy.everyCity}</option>
            {pay.cities.map((each) => (
              <option key={each} value={each}>
                {each}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </div>
  );
}

export function PayRates(props: { pay: TechnicianPay; may: May; onChanged: (pay: TechnicianPay) => void }) {
  const { pay, may } = props;
  const [city, setCity] = useState("");
  const [adding, setAdding] = useState(false);
  const [acting, setActing] = useState<Acting>(null);
  const [said, setSaid] = useState<string | null>(null);
  const done = (next: TechnicianPay, words: string) => {
    setAdding(false);
    setActing(null);
    setSaid(words);
    props.onChanged(next);
  };
  const act = (next: Acting) => {
    setSaid(null);
    setActing(next);
  };
  const row: RowProps = { pay, city, acting, may, onAct: act, onDone: done };
  return (
    <Panel
      titleId="pay-rates"
      title={copy.title}
      className={form.panel}
      actions={
        may.grades &&
        !adding && (
          <Button
            variant="outline"
            size="small"
            className={form.quiet}
            onClick={() => {
              setSaid(null);
              setAdding(true);
            }}
          >
            {copy.addGrade}
          </Button>
        )
      }
    >
      {adding && (
        <AddGradeForm
          onDone={(next) => {
            done(next, technicianPay.done.saved);
          }}
          onCancel={() => {
            setAdding(false);
          }}
        />
      )}
      {said !== null && (
        <InlineMessage tone="saved" className={form.saved}>
          {said}
        </InlineMessage>
      )}
      {pay.grades.length === 0 ? (
        <p className={form.note}>{copy.none}</p>
      ) : (
        <>
          <CityChoice pay={pay} city={city} onCity={setCity} />
          <RatesTable {...row} />
        </>
      )}
    </Panel>
  );
}
