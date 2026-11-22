// Reports › Driving (docs/decisions/0294-learned-drive-times.md): over the last week, 4 or 8, the drives between jobs
// by city and by technician, a day or a week a row, what booking plans for them against what they took; and every
// city's learned drive times, each with its drives and whether it has enough to be used.

import { Field, Select } from "@maneman/ui/Field";
import { Columns, Stack } from "@maneman/ui/Layout";
import { Note } from "@maneman/ui/Note";
import { Panel } from "@maneman/ui/Panel";
import { Segmented } from "@maneman/ui/Segmented";
import { StatTile } from "@maneman/ui/StatTile";
import { EmptyState } from "@maneman/ui/EmptyState";
import { PanelFailed, PanelLoading } from "@maneman/ui/States";
import { FIGURE, Table, TableScroll } from "@maneman/ui/Table";
import { Narrowing, SortHeads, TableEnd } from "@maneman/ui/TableTools";
import { Toolbar } from "@maneman/ui/Toolbar";
import { useLoad } from "@maneman/ui/useLoad";
import { useTableView, type Column } from "@maneman/ui/useTableView";
import { dayClock, shortDate } from "@maneman/web-kit/dates";
import { quantity } from "@maneman/web-kit/figures";
import { useCallback, useState } from "react";
import { hoursAndMinutes } from "../content/common.ts";
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

/** The figures of a row of drives, after its name and its day or week. */
function Figures({ row }: { row: DriveRow }) {
  return (
    <>
      <td className={FIGURE}>{quantity(row.drives)}</td>
      <td className={FIGURE}>{hoursAndMinutes(row.planned_minutes)}</td>
      <td className={FIGURE}>{hoursAndMinutes(row.actual_minutes)}</td>
      <td className={FIGURE}>{copy.signed(gapOf(row))}</td>
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

/** A city column, with a list to narrow by only where the header shows every city: one picked there, the report keeps to. */
function cityColumn<Row extends { city: string }>(label: string, everyCity: boolean): Column<Row> {
  const sort = (row: Row) => row.city;
  return everyCity ? { label, sort, choice: sort } : { label, sort };
}

/** The day or week a row counts: the column's head says which. */
function periodColumn<Row extends DriveRow>(by: DrivingBy): Column<Row> {
  return { label: by === "day" ? copy.columns.day : copy.columns.week, sort: (row) => row.period };
}

function Totals({ report }: { report: Driving }) {
  const sum = (pick: (row: DriveRow) => number) => report.by_city.reduce((total, row) => total + pick(row), 0);
  const planned = sum((row) => row.planned_minutes);
  const actual = sum((row) => row.actual_minutes);
  return (
    <Columns row>
      <StatTile label={copy.drives} value={quantity(sum((row) => row.drives))} />
      <StatTile label={copy.planned} value={copy.total(planned)} />
      <StatTile label={copy.actual} value={copy.total(actual)} />
      <StatTile label={copy.gap} value={copy.signedTotal(actual - planned)} />
    </Columns>
  );
}

/** What each table is drawn from: the report, by day or week, and whether the header shows every city. */
interface Shown {
  readonly report: Driving;
  readonly by: DrivingBy;
  readonly everyCity: boolean;
}

function ByCity({ report, by, everyCity }: Shown) {
  const columns: readonly Column<DriveRow>[] = [
    cityColumn<DriveRow>(copy.columns.city, everyCity),
    periodColumn<DriveRow>(by),
    ...figureColumns<DriveRow>(),
  ];
  const view = useTableView(report.by_city, columns);
  return (
    <Panel titleId="driving-cities" title={copy.byCity}>
      {report.by_city.length === 0 ? (
        <EmptyState look="panel" line={copy.noDrives} />
      ) : (
        <>
          <Narrowing view={view} label={copy.narrow.cities} />
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
                    <td>{shortDate(row.period)}</td>
                    <Figures row={row} />
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
          <TableEnd view={view} />
        </>
      )}
    </Panel>
  );
}

function ByTechnician({ report, by, everyCity }: Shown) {
  const columns: readonly Column<TechnicianRow>[] = [
    { label: copy.columns.technician, sort: (row) => row.name },
    cityColumn<TechnicianRow>(copy.columns.city, everyCity),
    periodColumn<TechnicianRow>(by),
    ...figureColumns<TechnicianRow>(),
  ];
  const view = useTableView(report.by_technician, columns, { search: (row) => row.name });
  if (report.by_technician.length === 0) return null;
  return (
    <Panel titleId="driving-technicians" title={copy.byTechnician}>
      <Narrowing view={view} label={copy.narrow.technicians} />
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
                <td>{shortDate(row.period)}</td>
                <Figures row={row} />
              </tr>
            ))}
          </tbody>
        </Table>
      </TableScroll>
      <TableEnd view={view} />
    </Panel>
  );
}

/** Every city's learned drive times, a weekday or weekend hour a row, and whether each has the drives to be used. */
function Learned({ report, everyCity }: Omit<Shown, "by">) {
  const minimum = report.learning.min_drives;
  const enough = (row: FactorRow) => row.drives >= minimum;
  const columns: readonly Column<FactorRow>[] = [
    cityColumn<FactorRow>(copy.learnedColumns.city, everyCity),
    {
      label: copy.learnedColumns.days,
      sort: (row) => row.day_kind,
      choice: (row) => copy.dayKinds[row.day_kind],
    },
    { label: copy.learnedColumns.hour, sort: (row) => row.hour },
    { label: copy.learnedColumns.pace, sort: (row) => row.factor_pct, figure: true },
    { label: copy.learnedColumns.drives, sort: (row) => row.drives, figure: true },
    { label: copy.learnedColumns.enough, sort: (row) => (enough(row) ? 1 : 0) },
  ];
  const view = useTableView(report.factors, columns);
  const note = report.learning.use === "estimate" ? copy.estimateOnly(minimum) : copy.used(minimum);
  return (
    <Panel titleId="driving-learned" title={copy.learned}>
      <Note>{note}</Note>
      {report.factors.length === 0 ? (
        <EmptyState look="panel" line={copy.noLearned} />
      ) : (
        <>
          <Narrowing view={view} label={copy.narrow.learned} />
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
                    <td>{enough(row) ? copy.yes : copy.notYet}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
          <TableEnd view={view} />
        </>
      )}
    </Panel>
  );
}

/** The days the figures count, beside the page's title. */
function Span({ from, to }: { from: string; to: string }) {
  useHeaderSub(copy.span(shortDate(from), shortDate(to)));
  return null;
}

/** The report for the city picked in the header, or every city: drawn afresh for each, its tables' choices with it. */
function Report({ weeks, by, city }: { weeks: DrivingWeeks; by: DrivingBy; city: string | null }) {
  const load = useCallback(() => drivingApi.driving(weeks, by, city), [weeks, by, city]);
  const [loaded, retry] = useLoad(load);
  if (loaded.state === "loading") return <PanelLoading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const report = loaded.value;
  return (
    <>
      <Span from={report.from} to={report.to} />
      <Totals report={report} />
      <ByCity report={report} by={by} everyCity={city === null} />
      <ByTechnician report={report} by={by} everyCity={city === null} />
      <Learned report={report} everyCity={city === null} />
    </>
  );
}

export function DrivingScreen() {
  const { city } = useCity();
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
      <Report key={`${weeks}/${by}/${city ?? ""}`} weeks={weeks} by={by} city={city} />
    </Stack>
  );
}
