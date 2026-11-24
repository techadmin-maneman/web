// Money › Technician pay (docs/decisions/0122-technician-pay-per-visit.md): a row each technician, as the redesign
// draws it, with their grade, visits by kind and pay at the rates per visit; the same by city and rate as a CSV for
// payroll. A technician with no grade is named above, as nothing they do is paid, and a visit no rate covered is
// marked, so the gap is seen before anyone is paid.

import { EmptyState } from "@maneman/ui/EmptyState";
import { Badge } from "@maneman/ui/Badge";
import { Button } from "@maneman/ui/Button";
import { Field, Select } from "@maneman/ui/Field";
import { InlineMessage } from "@maneman/ui/InlineMessage";
import { Panel } from "@maneman/ui/Panel";
import { RowHead } from "@maneman/ui/RowHead";
import { FIGURE, Table, TableScroll } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { rupees, rupeesTyped } from "@maneman/web-kit/money";
import { useCallback, useState } from "react";
import type { components } from "../api-schema.ts";
import { type TechnicianPay as Pay } from "../api.ts";
import { technicianPay } from "../content/technician-pay.ts";
import { OpsLink } from "../frame/Shell.tsx";
import { PageActions, useHeaderSub } from "../frame/PageHead.tsx";
import { csvText } from "../lib/csv.ts";
import { saveFile } from "../lib/save-file.ts";
import { settingsPath } from "../route.ts";
import { PanelLoading, PanelFailed } from "@maneman/ui/States";
import styles from "./pay-statement.module.css";
import { technicianPayApi } from "./technician-pay-api.ts";

const copy = technicianPay.statement;

type Line = components["schemas"]["PayStatement"]["lines"][number];
type Kind = Line["kind"];

/** The kinds of visit, in the order the redesign's columns run. */
const KINDS = Object.keys(technicianPay.kinds) as Kind[];

/** The twelve months to today's, newest first, as YYYY-MM. */
function monthsTo(today: string): string[] {
  const [year = 2026, month = 1] = today.split("-").map(Number);
  return Array.from({ length: 12 }, (_, back) => {
    const index = year * 12 + (month - 1) - back;
    return `${String(Math.floor(index / 12))}-${String((index % 12) + 1).padStart(2, "0")}`;
  });
}

/** The month's lines as payroll reads them: one row a line, amounts in rupees. */
function statementCsv(lines: readonly Line[]): string {
  return csvText([
    [...copy.columns],
    ...lines.map((line) => [
      line.technician,
      line.city ?? copy.noCity,
      technicianPay.kinds[line.kind],
      String(line.visits),
      line.rate === null ? "" : rupeesTyped(line.rate),
      line.amount === null ? "" : rupeesTyped(line.amount),
    ]),
  ]);
}

/** Each technician's month: their visits by kind, their total, and whether a visit went unpriced. */
function byTechnician(lines: readonly Line[]) {
  const groups = new Map<string, { name: string; lines: Line[] }>();
  for (const line of lines) {
    const group = groups.get(line.technician_id) ?? { name: line.technician, lines: [] };
    group.lines.push(line);
    groups.set(line.technician_id, group);
  }
  return [...groups].map(([id, group]) => ({
    id,
    name: group.name,
    visits: (kind: Kind) =>
      group.lines.filter((line) => line.kind === kind).reduce((sum, line) => sum + line.visits, 0),
    total: group.lines.reduce((sum, line) => sum + (line.amount ?? 0), 0),
    unpriced: group.lines.some((line) => line.rate === null),
  }));
}

/** A technician's grade by its name, or none. */
function gradeOf(pay: Pay, technicianId: string): string | null {
  const gradeId = pay.technicians.find((each) => each.id === technicianId)?.grade_id ?? null;
  return pay.grades.find((grade) => grade.id === gradeId)?.name ?? null;
}

function StatementTable({ lines, pay }: { lines: readonly Line[]; pay: Pay }) {
  const kinds = KINDS.filter((kind) => lines.some((line) => line.kind === kind));
  const technicians = byTechnician(lines);
  return (
    <TableScroll labelledBy="pay-statement">
      <Table>
        <thead>
          <tr>
            <th scope="col">{copy.technician}</th>
            <th scope="col">{copy.grade}</th>
            {kinds.map((kind) => (
              <th scope="col" key={kind} className={FIGURE}>
                {copy.kindHeads[kind]}
              </th>
            ))}
            <th scope="col" className={FIGURE}>
              {copy.amount}
            </th>
          </tr>
        </thead>
        <tbody>
          {technicians.map((technician) => (
            <tr key={technician.id}>
              <RowHead>{technician.name}</RowHead>
              <td>
                {gradeOf(pay, technician.id) ?? <Badge tone="warning">{technicianPay.technicians.noGrade}</Badge>}
              </td>
              {kinds.map((kind) => (
                <td key={kind} className={FIGURE}>
                  {technician.visits(kind)}
                </td>
              ))}
              <td className={FIGURE}>
                {rupees(technician.total)}
                {technician.unpriced && <span className={styles.unpriced}>{copy.unpriced}</span>}
              </td>
            </tr>
          ))}
          <tr className={styles.total}>
            <th scope="row" colSpan={kinds.length + 2}>
              {copy.totalOf(technicians.length)}
            </th>
            <td className={FIGURE}>{rupees(technicians.reduce((sum, each) => sum + each.total, 0))}</td>
          </tr>
        </tbody>
      </Table>
    </TableScroll>
  );
}

/** Technicians with no grade, named above the month, since nothing they do is paid until they have one. */
function Ungraded({ pay }: { pay: Pay }) {
  const ungraded = pay.technicians.filter((each) => each.grade_id === null);
  if (ungraded.length === 0) return null;
  return (
    <InlineMessage tone="note">
      {copy.ungraded(ungraded.map((each) => each.name))}{" "}
      <OpsLink to={settingsPath("pay-grades")}>{copy.setGrades}</OpsLink>
    </InlineMessage>
  );
}

/** The month shown, of the twelve to today's. */
function MonthPick(props: { months: readonly string[]; month: string; onMonth: (month: string) => void }) {
  return (
    <Field label={copy.month} labelHidden>
      {(control) => (
        <Select
          {...control}
          width="choice"
          value={props.month}
          onChange={(event) => {
            props.onMonth(event.target.value);
          }}
        >
          {props.months.map((each) => (
            <option key={each} value={each}>
              {copy.monthName(each)}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

export function PayStatement({ pay }: { pay: Pay }) {
  const months = monthsTo(pay.today);
  // A month's pay is drawn up once it has ended, so the last one is shown first.
  const [month, setMonth] = useState(months[1] ?? pay.today.slice(0, 7));
  const load = useCallback(() => technicianPayApi.payStatement(month), [month]);
  const [loaded, retry] = useLoad(load);
  useHeaderSub(copy.monthHead(month, month === months[0]));
  const lines = loaded.state === "loaded" ? loaded.value.lines : [];
  return (
    <>
      {lines.length > 0 && (
        <PageActions>
          <Button
            variant="outline"
            size="control"
            onClick={() => {
              saveFile(copy.fileName(month), statementCsv(lines), "text/csv");
            }}
          >
            {copy.download}
          </Button>
        </PageActions>
      )}
      <Ungraded pay={pay} />
      <Panel
        titleId="pay-statement"
        title={copy.title}
        actions={<MonthPick months={months} month={month} onMonth={setMonth} />}
      >
        {loaded.state === "loading" && <PanelLoading />}
        {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
        {loaded.state === "loaded" &&
          (lines.length === 0 ? (
            <EmptyState look="panel" line={copy.none} />
          ) : (
            <StatementTable lines={lines} pay={pay} />
          ))}
      </Panel>
    </>
  );
}
