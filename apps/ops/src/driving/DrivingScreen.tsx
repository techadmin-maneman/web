// Reports › Driving (docs/decisions/0294-learned-drive-times.md): over the last week, 4 or 8, the drives between jobs
// by city and by technician, a day or a week a row, what booking plans for them against what they took; and every
// city's learned drive times, each with its drives and whether booking plans with it.

import { Field, Select } from "@maneman/ui/Field";
import { Columns, Stack } from "@maneman/ui/Layout";
import { Note } from "@maneman/ui/Note";
import { Panel } from "@maneman/ui/Panel";
import { Segmented } from "@maneman/ui/Segmented";
import { StatTile } from "@maneman/ui/StatTile";
import { EmptyState } from "@maneman/ui/EmptyState";
import { PanelFailed, PanelLoading } from "@maneman/ui/States";
import { FIGURE, Table, TableScroll } from "@maneman/ui/Table";
import { SortHeads } from "@maneman/ui/TableTools";
import { Toolbar } from "@maneman/ui/Toolbar";
import { useLoad } from "@maneman/ui/useLoad";
import { useTableView, type Column } from "@maneman/ui/useTableView";
import { dayClock, shortDate } from "@maneman/web-kit/dates";
import { quantity } from "@maneman/web-kit/figures";
import { useCallback, useState } from "react";
import { driving as copy } from "../content/driving.ts";
import { useHeaderSub } from "../frame/PageHead.tsx";
import { useCity } from "../lib/city.ts";
import { drivingApi, type Driving, type DrivingBy, type DrivingWeeks } from "./driving-api.ts";
import styles from "./driving.module.css";

const WEEKS: readonly DrivingWeeks[] = ["1", "4", "8"];
const isWeeks = (value: string): value is DrivingWeeks => WEEKS.some((weeks) => weeks === value);

type DriveRow = Driving["by_city"][number];
type TechnicianRow = Driving["by_technician"][number];
type FactorRow = Driving["factors"][number];

const gapOf = (row: DriveRow) => row.actual_minutes - row.planned_minutes;
const periodName = (period: string, by: DrivingBy) =>
  by === "day" ? shortDate(period) : copy.weekOf(shortDate(period));

/** The figures of a row of drives, after its name and its day or week. */
function Figures({ row }: { row: DriveRow }) {
  return (
    <>
      <td className={FIGURE}>{quantity(row.drives)}</td>
      <td className={FIGURE}>{copy.minutes(row.planned_minutes)}</td>
      <td className={FIGURE}>{copy.minutes(row.actual_minutes)}</td>
      <td className={FIGURE}>{copy.gapMinutes(gapOf(row))}</td>
    </>
  );
}

function figureColumns<Row extends DriveRow>(): Column<Row>[] {
  return [
    { label: copy.drives, sort: (row) => row.drives, figure: true },
    { label: copy.planned, sort: (row) => row.planned_minutes, figure: true },
    { label: copy.actual, sort: (row) => row.actual_minutes, figure: true },
    { label: copy.gap, sort: gapOf, figure: true },
  ];
}

function Totals({ report }: { report: Driving }) {
  const sum = (pick: (row: DriveRow) => number) => report.by_city.reduce((total, row) => total + pick(row), 0);
  const planned = sum((row) => row.planned_minutes);
  const actual = sum((row) => row.actual_minutes);
  return (
    <Columns row>
      <StatTile label={copy.drives} value={sum((row) => row.drives)} />
      <StatTile label={copy.planned} value={copy.minutes(planned)} />
      <StatTile label={copy.actual} value={copy.minutes(actual)} />
      <StatTile label={copy.gap} value={copy.gapMinutes(actual - planned)} />
    </Columns>
  );
}

function ByCity({ report, by }: { report: Driving; by: DrivingBy }) {
  const columns: readonly Column<DriveRow>[] = [
    { label: copy.columns.city, sort: (row) => row.city },
    { label: by === "day" ? copy.columns.day : copy.columns.week, sort: (row) => row.period },
    ...figureColumns<DriveRow>(),
  ];
  const view = useTableView(report.by_city, columns);
  return (
    <Panel titleId="driving-cities" title={copy.byCity}>
      {report.by_city.length === 0 ? (
        <EmptyState look="panel" line={copy.noDrives} />
      ) : (
        <TableScroll labelledBy="driving-cities">
          <Table className={styles.table}>
            <thead>
              <tr>
                <SortHeads view={view} />
              </tr>
            </thead>
            <tbody>
              {view.shown.map((row) => (
                <tr key={`${row.city}/${row.period}`}>
                  <th scope="row" className={styles.who}>
                    {row.city}
                  </th>
                  <td>{periodName(row.period, by)}</td>
                  <Figures row={row} />
                </tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      )}
    </Panel>
  );
}

function ByTechnician({ report, by }: { report: Driving; by: DrivingBy }) {
  const columns: readonly Column<TechnicianRow>[] = [
    { label: copy.columns.technician, sort: (row) => row.name },
    { label: copy.columns.city, sort: (row) => row.city },
    { label: by === "day" ? copy.columns.day : copy.columns.week, sort: (row) => row.period },
    ...figureColumns<TechnicianRow>(),
  ];
  const view = useTableView(report.by_technician, columns);
  if (report.by_technician.length === 0) return null;
  return (
    <Panel titleId="driving-technicians" title={copy.byTechnician}>
      <TableScroll labelledBy="driving-technicians">
        <Table className={styles.table}>
          <thead>
            <tr>
              <SortHeads view={view} />
            </tr>
          </thead>
          <tbody>
            {view.shown.map((row) => (
              <tr key={`${row.technician_id}/${row.period}`}>
                <th scope="row" className={styles.who}>
                  {row.name}
                </th>
                <td>{row.city}</td>
                <td>{periodName(row.period, by)}</td>
                <Figures row={row} />
              </tr>
            ))}
          </tbody>
        </Table>
      </TableScroll>
    </Panel>
  );
}

const FACTOR_COLUMNS: readonly Column<FactorRow>[] = [
  { label: copy.learnedColumns.city, sort: (row) => row.city },
  { label: copy.learnedColumns.days, sort: (row) => row.day_kind },
  { label: copy.learnedColumns.hour, sort: (row) => row.hour },
  { label: copy.learnedColumns.pace, sort: (row) => row.factor_pct, figure: true },
  { label: copy.learnedColumns.drives, sort: (row) => row.drives, figure: true },
  { label: copy.learnedColumns.used, sort: (row) => (row.in_use ? 1 : 0) },
];

/** Every city's learned drive times, a slot a row, and whether booking plans with each. */
function Learned({ report }: { report: Driving }) {
  const view = useTableView(report.factors, FACTOR_COLUMNS);
  const note = report.learning.use === "estimate" ? copy.estimateOnly : copy.minimum(report.learning.min_drives);
  return (
    <Panel titleId="driving-learned" title={copy.learned}>
      <Note>{note}</Note>
      {report.factors.length === 0 ? (
        <EmptyState look="panel" line={copy.noLearned} />
      ) : (
        <TableScroll labelledBy="driving-learned">
          <Table className={styles.table}>
            <thead>
              <tr>
                <SortHeads view={view} />
              </tr>
            </thead>
            <tbody>
              {view.shown.map((row) => (
                <tr key={`${row.city}/${row.day_kind}/${String(row.hour)}`}>
                  <th scope="row" className={styles.who}>
                    {row.city}
                  </th>
                  <td>{copy.dayKinds[row.day_kind]}</td>
                  <td>{dayClock(`${String(row.hour).padStart(2, "0")}:00`)}</td>
                  <td className={FIGURE}>{copy.pace(row.factor_pct)}</td>
                  <td className={FIGURE}>{quantity(row.drives)}</td>
                  <td>{row.in_use ? copy.used : copy.notYet}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      )}
    </Panel>
  );
}

/** The days the figures count, beside the page's title. */
function Span({ from, to }: { from: string; to: string }) {
  useHeaderSub(copy.span(shortDate(from), shortDate(to)));
  return null;
}

function Report({ weeks, by }: { weeks: DrivingWeeks; by: DrivingBy }) {
  const { city } = useCity();
  const load = useCallback(() => drivingApi.driving(weeks, by, city), [weeks, by, city]);
  const [loaded, retry] = useLoad(load);
  if (loaded.state === "loading") return <PanelLoading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const report = loaded.value;
  return (
    <>
      <Span from={report.from} to={report.to} />
      <Totals report={report} />
      <ByCity report={report} by={by} />
      <ByTechnician report={report} by={by} />
      <Learned report={report} />
    </>
  );
}

export function DrivingScreen() {
  const [weeks, setWeeks] = useState<DrivingWeeks>("4");
  const [by, setBy] = useState<DrivingBy>("week");
  return (
    <Stack>
      <Toolbar label={copy.period}>
        <Field label={copy.period} labelHidden>
          {(control) => (
            <Select
              {...control}
              width="choice"
              value={weeks}
              onChange={(event) => {
                if (isWeeks(event.target.value)) setWeeks(event.target.value);
              }}
            >
              {WEEKS.map((each) => (
                <option key={each} value={each}>
                  {copy.periods[each]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Segmented
          label={copy.by}
          options={[
            ["day", copy.bys.day],
            ["week", copy.bys.week],
          ]}
          value={by}
          onChange={setBy}
        />
      </Toolbar>
      <Report key={`${weeks}/${by}`} weeks={weeks} by={by} />
    </Stack>
  );
}
