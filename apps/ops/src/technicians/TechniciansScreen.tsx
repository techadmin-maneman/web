// Technicians: who works, their city, and the jobs they have finished and how those ran, one row each. Nothing records
// a technician's skills, so Leave stands in the design's Skill column (docs/open-points.md, item 59). A name opens
// their page (./TechnicianScreen.tsx); they are added here (./TechnicianForms.tsx).

import { quantity } from "@maneman/web-kit/figures";
import { plainDate } from "@maneman/web-kit/plain-date";
import { textLinkLook } from "@maneman/ui/TextLink";
import { Panel } from "@maneman/ui/Panel";
import { Apart } from "@maneman/ui/Apart";
import { Toast } from "@maneman/ui/Toast";
import { classes } from "@maneman/ui/classes";
import { EmptyState } from "@maneman/ui/EmptyState";
import { FIGURE, Table } from "@maneman/ui/Table";
import { capsLook } from "@maneman/ui/Caps";
import { Button } from "@maneman/ui/Button";
import { failedRequestId, useLoad } from "@maneman/ui/useLoad";
import { addDays, listDate, todayInIndia } from "@maneman/web-kit/dates";
import { Field, Select } from "@maneman/ui/Field";
import { useCallback, useState, type ReactNode } from "react";
import {
  type Leave,
  type Roster as RosterBook,
  type Technician,
  type TechnicianSummary,
  type TechnicianWork,
} from "../api.ts";
import { OpsLink } from "../frame/Shell.tsx";
import { PageActions, useHeaderSub } from "../frame/PageHead.tsx";
import { technicians } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { useCity } from "../lib/city.ts";
import { technicianPath } from "../route.ts";
import { PanelLoading, PanelFailed } from "@maneman/ui/States";
import { Narrowing, SortHeads, TableEnd } from "@maneman/ui/TableTools";
import { useTableView, type Column, type TableView } from "@maneman/ui/useTableView";
import { AddTechnician } from "./TechnicianForms.tsx";
import shared from "./technicians.module.css";
import styles from "./technicians-screen.module.css";
import { techniciansApi } from "./technicians-api.ts";
import { apiNow } from "@maneman/web-kit/clock";

/** The route's period ends the day after the last one counted; the note names that last day. */
const lastDay = (exclusiveEnd: string) => addDays(exclusiveEnd, -1);

const DAY_MS = 86_400_000;

/**
 * How long the technician's visits took, on average. A technician the phone
 * timed none of reads as a gap, never as a nought: the jobs were done and
 * nothing timed them. One who runs over the length their visits were planned
 * for, by as much as ops set (docs/decisions/0088-every-policy-in-the-console.md),
 * reads in oxblood, as the board letters its own long average.
 */
function Service({ figures }: { figures: TechnicianWork | undefined }) {
  const copy = technicians.work;
  const average = figures?.average_minutes ?? null;
  const planned = figures?.average_planned_minutes ?? null;
  // Under a minute is a job closed as it was started, not a visit's length.
  if (figures === undefined || average === null || planned === null || average < 1) {
    return <None />;
  }

  return (
    <>
      <span className={figures.runs_over ? shared.over : undefined}>
        {copy.average(Math.floor(average / 60), average % 60)}
      </span>
      {/* The average is of the jobs the phone timed, so it says so when that is not all of them. */}
      {figures.timed_jobs < figures.jobs && (
        <span className={shared.base}>{copy.base(figures.timed_jobs, figures.jobs)}</span>
      )}
    </>
  );
}

/** The share of the jobs checked in by the end of the arrival window; null with no job done. */
const onTimeShare = (figures: TechnicianWork | undefined): number | null =>
  figures === undefined || figures.jobs === 0 ? null : figures.on_time_jobs / figures.jobs;

/** The jobs a technician has finished, grouped as every figure is, or a gap where none are counted. */
const jobsOf = (jobs: number | undefined): ReactNode => (jobs === undefined ? <None /> : quantity(jobs));

function OnTime({ figures }: { figures: TechnicianWork | undefined }) {
  if (figures === undefined || figures.jobs === 0) return <None />;
  return <>{technicians.work.onTime(figures.on_time_jobs, figures.jobs)}</>;
}

/** The Leave column: away today and until when, the first day of leave still to come, or a gap. */
function LeaveCell({ leave, today }: { leave: readonly Leave[]; today: string }) {
  const next = leave[0];
  if (next === undefined) return <None />;
  const year = Number(today.slice(0, 4));
  if (next.from <= today)
    return <span className={capsLook(shared.away)}>{technicians.away(listDate(next.to, year))}</span>;
  return <span>{technicians.from(listDate(next.from, year))}</span>;
}

/** A row of the roster, with the leave it shows. */
type Listed = TechnicianSummary & { readonly leave?: readonly Leave[] };

/** The roster's columns, each sorting its own. */
function columnsOf(figures: ReadonlyMap<string, TechnicianWork>): readonly Column<Listed>[] {
  const city = (row: Listed) => row.city ?? "";
  const [name, cityLabel, jobs, service, onTime, leave] = technicians.columns;
  return [
    { label: name, sort: (row) => row.name },
    { label: cityLabel, sort: city },
    { label: jobs, sort: (row) => figures.get(row.id)?.jobs ?? -1, figure: true },
    { label: service, sort: (row) => figures.get(row.id)?.average_minutes ?? -1, figure: true },
    { label: onTime, sort: (row) => onTimeShare(figures.get(row.id)) ?? -1, figure: true },
    { label: leave, sort: (row) => row.leave?.[0]?.from ?? "" },
  ];
}

/** The roster's table. No city is a warning: it is why nothing can be booked on them. */
function TechnicianTable({ view, figures }: { view: TableView<Listed>; figures: ReadonlyMap<string, TechnicianWork> }) {
  const today = todayInIndia(apiNow());
  return (
    <Table fixed className={styles.table}>
      <thead>
        <tr>
          <SortHeads view={view} />
        </tr>
      </thead>
      <tbody>
        {view.shown.map((technician) => (
          <tr key={technician.id}>
            <th scope="row" className={shared.name}>
              <OpsLink className={textLinkLook({ compact: true })} to={technicianPath(technician.id)}>
                {technician.name}
              </OpsLink>
            </th>
            <td className={classes(shared.city, technician.city === null && shared.noCity)}>
              {technician.city ?? technicians.noCity}
            </td>
            <td className={FIGURE}>{jobsOf(figures.get(technician.id)?.jobs)}</td>
            <td className={FIGURE}>
              <Service figures={figures.get(technician.id)} />
            </td>
            <td className={FIGURE}>
              <OnTime figures={figures.get(technician.id)} />
            </td>
            <td>
              <LeaveCell leave={technician.leave ?? []} today={today} />
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** Those switched off, in a folded panel of their own: they cannot sign in, and nothing is booked on them. */
function SwitchedOff({ list }: { list: readonly TechnicianSummary[] }) {
  const [name, city] = technicians.columns;
  const view = useTableView<TechnicianSummary>(
    list,
    [
      { label: name, sort: (row) => row.name },
      { label: city, sort: (row) => row.city ?? "" },
    ],
    { search: (row) => `${row.name} ${row.city ?? ""}` },
  );
  return (
    <Apart id="switched-off" title={technicians.switchedOff} count={list.length}>
      <Table>
        <thead>
          <tr>
            <SortHeads view={view} />
          </tr>
        </thead>
        <tbody>
          {view.shown.map((technician) => (
            <tr key={technician.id}>
              <th scope="row" className={shared.name}>
                <OpsLink className={textLinkLook({ compact: true })} to={technicianPath(technician.id)}>
                  {technician.name}
                </OpsLink>
              </th>
              <td>{technician.city ?? <None />}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <TableEnd view={view} />
    </Apart>
  );
}

/** A figure or a date not there to give. */
const None = () => <span className={shared.none}>{technicians.unknown}</span>;

/** The periods offered beside the one shown: a month, a quarter and a year. */
const PERIODS = [30, 90, 365];

/** Over how many days back the figures count, ops's own period until another is chosen. */
function PeriodChoice({ counted, onFrom }: { counted: { from: string; to: string }; onFrom: (from: string) => void }) {
  const days = Math.round((Date.parse(counted.to) - Date.parse(counted.from)) / DAY_MS);
  const offered = [...new Set([...PERIODS, days])].sort((one, other) => one - other);
  return (
    <Field label={technicians.work.over} labelHidden>
      {(control) => (
        <Select
          {...control}
          width="choice"
          value={String(days)}
          onChange={(event) => {
            // The route counts to tomorrow, so the last N days start N - 1 days before today.
            onFrom(addDays(todayInIndia(apiNow()), 1 - Number(event.target.value)));
          }}
        >
          {offered.map((each) => (
            <option key={each} value={each}>
              {technicians.work.days(each)}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

/** The roster's table: the active technicians, one row each, and the period its figures count over. */
function RosterTable({
  active,
  figures,
  period,
}: {
  active: readonly Technician[];
  figures: ReadonlyMap<string, TechnicianWork>;
  period: ReactNode;
}) {
  const view = useTableView<Listed>(active, columnsOf(figures), {
    search: (row) => `${row.name} ${row.city ?? ""}`,
  });
  return (
    <>
      <Narrowing view={view} label={technicians.narrow}>
        {period}
      </Narrowing>
      <TechnicianTable view={view} figures={figures} />
      <TableEnd view={view} />
    </>
  );
}

/** The days the figures count, beside the page's title. */
function Period({ from, to }: { from: string; to: string }) {
  useHeaderSub(technicians.work.period(plainDate(from), plainDate(lastDay(to))));
  return null;
}

/** The figures, over ops's own period until another is chosen; a choice keeps the last shown until it answers. */
function useWork() {
  const [from, setFrom] = useState<string | null>(null);
  const read = useCallback(() => techniciansApi.technicianWork(from), [from]);
  const [work, retry] = useLoad(read);
  return [work, retry, setFrom] as const;
}

function Roster() {
  const [loaded, retry] = useLoad(techniciansApi.technicians);
  // The roster carries no period, so the figures are a read of their own; the
  // table is one table either way, and waits for both.
  const [work, retryWork, setFrom] = useWork();
  // The roster as read again after a technician is added.
  const [fresh, setFresh] = useState<RosterBook | null>(null);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const mayAdd = useAccess().mayCall("POST /api/technicians");
  const { city } = useCity();

  if (loaded.state === "loading" || work.state === "loading") return <PanelLoading />;
  if (loaded.state === "failed" || work.state === "failed") {
    return (
      <PanelFailed
        onRetry={() => {
          retry();
          retryWork();
        }}
        requestId={failedRequestId(loaded) ?? failedRequestId(work)}
      />
    );
  }

  // Those of the city chosen in the header (ADR 0225), or everyone's.
  const whole = fresh ?? loaded.value;
  const inCity = <T extends { readonly city: string | null }>(list: readonly T[]): readonly T[] =>
    city === null ? list : list.filter((each) => each.city === city);
  const roster = { ...whole, technicians: inCity(whole.technicians), switched_off: inCity(whole.switched_off) };
  const figures = new Map(work.value.technicians.map((each) => [each.technician_id, each]));
  const readAgain = async () => {
    const answer = await techniciansApi.technicians();
    if (answer.ok) setFresh(answer.body);
  };

  return (
    <>
      <Panel titleId="roster" title={technicians.title}>
        {mayAdd && (
          <PageActions>
            <Button
              variant="primary"
              size="small"
              onClick={() => {
                setAdded(null);
                setAdding(true);
              }}
            >
              {technicians.add.open}
            </Button>
          </PageActions>
        )}
        <Period from={work.value.from} to={work.value.to} />
        {added !== null && <Toast>{technicians.add.added(added)}</Toast>}
        {roster.technicians.length === 0 ? (
          <EmptyState look="panel" line={technicians.empty} />
        ) : (
          <RosterTable
            active={roster.technicians}
            figures={figures}
            period={<PeriodChoice counted={work.value} onFrom={setFrom} />}
          />
        )}
        {adding && (
          <AddTechnician
            cities={roster.cities}
            onAdded={async (name) => {
              await readAgain();
              setAdding(false);
              setAdded(name);
            }}
            onClose={() => {
              setAdding(false);
            }}
          />
        )}
      </Panel>
      {roster.switched_off.length > 0 && <SwitchedOff list={roster.switched_off} />}
    </>
  );
}

export function TechniciansScreen() {
  return <Roster />;
}
