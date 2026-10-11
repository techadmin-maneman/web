// What each grade is paid for each kind of visit, for every city or one (docs/decisions/0122-technician-pay-per-visit.md).
// A city with no rate of its own shows every city's, marked; a rate set to start later shows beneath the one in force.
// Each grade's row sets a rate, renames the grade, or, while no technician holds it, deletes it.

import { Button } from "@maneman/ui/Button";
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
import styles from "../components/forms.module.css";
import own from "./technician-pay.module.css";

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
function RowActions({ grade, acting, may, onAct }: { grade: Grade } & Pick<RowProps, "acting" | "may" | "onAct">) {
  const actions: readonly (readonly [boolean, NonNullable<Acting>["kind"], string, string])[] = [
    [may.rates, "rate", copy.setRate, copy.setRateLabel(grade.name)],
    [may.grades, "rename", copy.rename, copy.renameLabel(grade.name)],
    [may.grades && grade.technicians === 0, "delete", copy.delete, copy.deleteLabel(grade.name)],
  ];
  return (
    <td className={own.actions}>
      {actions
        .filter(([shown]) => shown)
        .map(([, kind, words, label]) => (
          <button
            key={kind}
            className={styles.inline}
            type="button"
            aria-label={label}
            disabled={acting !== null}
            onClick={() => {
              onAct({ id: grade.id, kind });
            }}
          >
            {words}
          </button>
        ))}
    </td>
  );
}

/** Beneath a grade's row, what its action opened. */
function ActingRow({ grade, span, ...row }: { grade: Grade; span: number } & RowProps) {
  const { acting, onAct, onDone } = row;
  if (acting?.id !== grade.id) return null;
  const cancel = () => {
    onAct(null);
  };
  const saved = (pay: TechnicianPay) => {
    onDone(pay, technicianPay.done.saved);
  };
  return (
    <tr className={own.acting}>
      <td colSpan={span}>
        {acting.kind === "rate" && (
          <SetRateForm grade={grade} pay={row.pay} city={row.city} onDone={saved} onCancel={cancel} />
        )}
        {acting.kind === "rename" && <RenameGradeForm grade={grade} onDone={saved} onCancel={cancel} />}
        {acting.kind === "delete" && (
          <div className={own.ask}>
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
        <th scope="row" className={own.grade}>
          {grade.name}
        </th>
        <td className={own.figure}>{grade.technicians}</td>
        {pay.kinds.map((kind) => (
          <td key={kind} className={own.figure}>
            {rateNow(pay, { grade: grade.id, kind, city })}
            {ratesLater(pay, { grade: grade.id, kind, city }).map((line) => (
              <span key={line} className={own.later}>
                {line}
              </span>
            ))}
          </td>
        ))}
        <RowActions grade={grade} {...row} />
      </tr>
      <ActingRow grade={grade} span={pay.kinds.length + 3} {...row} />
    </>
  );
}

function RatesTable(row: RowProps) {
  return (
    <div className={own.scroll}>
      <Table className={classes(styles.table, own.table, own.rates)}>
        <thead>
          <tr>
            <th scope="col">{copy.grade}</th>
            <th scope="col" className={own.figure}>
              {copy.technicians}
            </th>
            {row.pay.kinds.map((kind) => (
              <th key={kind} scope="col" className={own.figure}>
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
    <div className={own.tools}>
      <Field label={copy.city}>
        {(control) => (
          <Select
            {...control}
            className={styles.choiceBox}
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
      className={styles.panel}
      actions={
        may.grades &&
        !adding && (
          <Button
            variant="outline"
            size="small"
            className={styles.quiet}
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
        <p className={styles.saved} role="status">
          {said}
        </p>
      )}
      {pay.grades.length === 0 ? (
        <p className={styles.note}>{copy.none}</p>
      ) : (
        <>
          <CityChoice pay={pay} city={city} onCity={setCity} />
          <RatesTable {...row} />
        </>
      )}
    </Panel>
  );
}
