// The month's pay at the rates per visit (docs/decisions/0122-technician-pay-per-visit.md): each technician's visits
// closed in it, by kind and city, at the rate in force on each one's day, with the total, and the same as a CSV for
// payroll. A visit no rate covered shows as such, so the gap is seen before anyone is paid.

import { Button } from "@maneman/ui/Button";
import { Field, Select } from "@maneman/ui/Field";
import { Panel } from "@maneman/ui/Panel";
import { Table } from "@maneman/ui/Table";
import { classes } from "@maneman/ui/classes";
import { useLoad } from "@maneman/ui/useLoad";
import { rupees, rupeesTyped } from "@maneman/web-kit/money";
import { useCallback, useState } from "react";
import { api } from "../api.ts";
import type { components } from "../api-schema.ts";
import { technicianPay } from "../content/technician-pay.ts";
import { csvText } from "../lib/csv.ts";
import { saveFile } from "../lib/save-file.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import styles from "../components/forms.module.css";
import own from "./technician-pay.module.css";

const copy = technicianPay.statement;

type Line = components["schemas"]["PayStatement"]["lines"][number];

/** The twelve months to today's, newest first, as YYYY-MM. */
function monthsTo(today: string): string[] {
  const [year = 2026, month = 1] = today.split("-").map(Number);
  return Array.from({ length: 12 }, (_, back) => {
    const index = year * 12 + (month - 1) - back;
    return `${String(Math.floor(index / 12))}-${String((index % 12) + 1).padStart(2, "0")}`;
  });
}

const amountOf = (paise: number | null): string => (paise === null ? copy.noRate : rupees(paise));

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

/** Each technician's lines, with their total and whether a visit went unpriced. */
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
    lines: group.lines,
    total: group.lines.reduce((sum, line) => sum + (line.amount ?? 0), 0),
    unpriced: group.lines.some((line) => line.rate === null),
  }));
}

function StatementTable({ lines }: { lines: readonly Line[] }) {
  return (
    <div className={own.scroll}>
      <Table className={classes(styles.table, own.table, own.people)}>
        <thead>
          <tr>
            {copy.columns.map((column) => (
              <th scope="col" key={column}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {byTechnician(lines).map((technician) => [
            ...technician.lines.map((line) => (
              <tr key={`${technician.id}-${line.city ?? ""}-${line.kind}-${String(line.rate)}`}>
                <th scope="row">{technician.name}</th>
                <td>{line.city ?? copy.noCity}</td>
                <td>{technicianPay.kinds[line.kind]}</td>
                <td className={own.figure}>{line.visits}</td>
                <td className={own.figure}>{amountOf(line.rate)}</td>
                <td className={own.figure}>{amountOf(line.amount)}</td>
              </tr>
            )),
            <tr key={`${technician.id}-total`} className={own.total}>
              <th scope="row" colSpan={5}>
                {technician.unpriced ? copy.totalUnpriced(technician.name) : copy.total(technician.name)}
              </th>
              <td className={own.figure}>{rupees(technician.total)}</td>
            </tr>,
          ])}
        </tbody>
      </Table>
    </div>
  );
}

export function PayStatement({ today }: { today: string }) {
  const months = monthsTo(today);
  // A month's pay is drawn up once it has ended, so the last one is shown first.
  const [month, setMonth] = useState(months[1] ?? today.slice(0, 7));
  const load = useCallback(() => api.payStatement(month), [month]);
  const [loaded, retry] = useLoad(load);
  return (
    <Panel titleId="pay-statement" title={copy.title} className={styles.panel}>
      <div className={own.tools}>
        <Field label={copy.month} className={styles.field}>
          {(control) => (
            <Select
              {...control}
              value={month}
              onChange={(event) => {
                setMonth(event.target.value);
              }}
            >
              {months.map((each) => (
                <option key={each} value={each}>
                  {copy.monthName(each)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {loaded.state === "loaded" && loaded.value.lines.length > 0 && (
          <Button
            variant="outline"
            size="control"
            onClick={() => {
              saveFile(copy.fileName(month), statementCsv(loaded.value.lines), "text/csv");
            }}
          >
            {copy.download}
          </Button>
        )}
      </div>
      {loaded.state === "loading" && <Loading />}
      {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
      {loaded.state === "loaded" &&
        (loaded.value.lines.length === 0 ? (
          <p className={styles.note}>{copy.none}</p>
        ) : (
          <StatementTable lines={loaded.value.lines} />
        ))}
    </Panel>
  );
}
