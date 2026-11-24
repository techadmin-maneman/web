// A technician's grade from a day, and the history of grades and rates (docs/decisions/0311-dated-technician-grades.md):
// a visit is paid on the grade held on its day, so a change asks the day it starts, today to begin with, and the
// grades and rates set before it stay listed beneath.

import { EditableRow } from "@maneman/ui/EditableRow";
import { DateInput, Select } from "@maneman/ui/Field";
import { Table, TableScroll } from "@maneman/ui/Table";
import { fullDate, indiaDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { errorText } from "@maneman/web-kit/refusal";
import type { TechnicianPay } from "../api.ts";
import { EDITING } from "../content/common.ts";
import { technicianPay } from "../content/technician-pay.ts";
import styles from "./pay-rates.module.css";
import { technicianPayApi } from "./technician-pay-api.ts";

const copy = technicianPay.grading;

/** The day migration 0238 gave every grade already held: from before grades had a start. */
const FROM_THE_START = "2000-01-01";

const nameOf = (pay: TechnicianPay, grade: string | null) =>
  grade === null ? null : (pay.grades.find((each) => each.id === grade)?.name ?? null);

/** A start in words: its day, or that it has held since before grades had a start. */
const fromWords = (day: string) => (day === FROM_THE_START ? copy.always : fullDate(day));

/** The technician's grade today in words, then each change set to start later. */
function gradeLine(pay: TechnicianPay, technicianId: string): string {
  const today = pay.technicians.find((each) => each.id === technicianId)?.grade_id ?? null;
  const later = pay.grade_history
    .filter((each) => each.technician_id === technicianId && each.effective_from > pay.today)
    .reverse()
    .map((each) => copy.later(nameOf(pay, each.grade_id) ?? copy.none, fullDate(each.effective_from)));
  return [nameOf(pay, today) ?? copy.notPaid, ...later].join(", then ");
}

interface Draft {
  /** The grade's ID, "" for none. */
  readonly grade: string;
  readonly from: string;
}

/** The technician's grade, changed where it reads, from a day today or later. */
export function GradeFromRow(props: {
  /** The row's name where the page names a grade otherwise, as a technician's details do. */
  readonly label?: string;
  readonly pay: TechnicianPay;
  readonly technicianId: string;
  readonly mayChange: boolean;
  readonly onSaved: (pay: TechnicianPay) => void;
}) {
  const { pay, technicianId } = props;
  return (
    <EditableRow<Draft>
      label={props.label ?? copy.grade}
      words={EDITING}
      mayChange={props.mayChange}
      value={gradeLine(pay, technicianId)}
      start={() => ({
        grade: pay.technicians.find((each) => each.id === technicianId)?.grade_id ?? "",
        from: pay.today,
      })}
      save={async (draft) => {
        if (draft.from < pay.today) return copy.fromToday;
        const answer = await technicianPayApi.setPayGradeOf(
          technicianId,
          draft.grade === "" ? null : draft.grade,
          draft.from,
        );
        if (!answer.ok) return errorText(technicianPay.errors, answer);
        props.onSaved(answer.body);
        return null;
      }}
    >
      {(control, draft, edit) => (
        <>
          <Select
            {...control}
            value={draft.grade}
            onChange={(event) => {
              edit({ ...draft, grade: event.target.value });
            }}
          >
            <option value="">{copy.none}</option>
            {pay.grades.map((grade) => (
              <option key={grade.id} value={grade.id}>
                {grade.name}
              </option>
            ))}
          </Select>
          <DateInput
            width="date"
            aria-label={copy.from}
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

/** Every grade the technician was given, by the day each starts, the latest first, with who set it and when. */
export function GradeHistory({ pay, technicianId }: { readonly pay: TechnicianPay; readonly technicianId: string }) {
  const rows = pay.grade_history.filter((each) => each.technician_id === technicianId);
  if (rows.length === 0) return null;
  const words = copy.history;
  return (
    <section aria-labelledby="grade-history" className={styles.history}>
      <h3 id="grade-history" className={styles.ratesTitle}>
        {words.title}
      </h3>
      <TableScroll labelledBy="grade-history">
        <Table>
          <thead>
            <tr>
              <th scope="col">{words.from}</th>
              <th scope="col">{copy.grade}</th>
              <th scope="col">{words.setBy}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((each) => (
              <tr key={each.effective_from}>
                <td>{fromWords(each.effective_from)}</td>
                <td>{nameOf(pay, each.grade_id) ?? copy.none}</td>
                <td className={styles.setBy}>{words.setOn(each.set_by, fullDate(indiaDate(each.set_at)))}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableScroll>
    </section>
  );
}

/** Every rate the grade was given, for every city or one, the latest start first: what it paid, and from when. */
export function RateHistory({ pay, gradeId }: { readonly pay: TechnicianPay; readonly gradeId: string }) {
  const rows = pay.rate_history.filter((each) => each.grade_id === gradeId);
  if (rows.length === 0) return null;
  const words = technicianPay.rates.history;
  return (
    <section aria-labelledby="rate-history" className={styles.history}>
      <h3 id="rate-history" className={styles.ratesTitle}>
        {words.title}
      </h3>
      <TableScroll labelledBy="rate-history">
        <Table>
          <thead>
            <tr>
              <th scope="col">{words.from}</th>
              <th scope="col">{words.kind}</th>
              <th scope="col">{words.city}</th>
              <th scope="col">{words.amount}</th>
              <th scope="col">{copy.history.setBy}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((each) => (
              <tr key={`${each.kind}-${each.city ?? ""}-${each.effective_from}`}>
                <td>{fullDate(each.effective_from)}</td>
                <td>{technicianPay.kinds[each.kind]}</td>
                <td>{each.city ?? words.everyCity}</td>
                <td>{each.amount === null ? words.none : rupees(each.amount)}</td>
                <td className={styles.setBy}>{copy.history.setOn(each.set_by, fullDate(indiaDate(each.set_at)))}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableScroll>
    </section>
  );
}
