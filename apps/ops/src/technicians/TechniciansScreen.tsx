// Technicians: who works, their zone, the jobs they
// have finished and how those ran, one 34 px row each, as the board draws them,
// however many there are. The board's fifth column is Skill, and nothing records
// what a technician is trained for, so Leave stands there instead and a line
// beneath the table says why (docs/open-points.md, item 59).
//
// A technician's name opens their own page (./TechnicianScreen.tsx): their details,
// week, leave, phones and kit, which the board's rows have no room for. Ops add
// technicians here (./TechnicianForms.tsx); those switched off are listed
// beneath the table.

import { capsLook } from "@maneman/ui/Caps";
import { Button } from "@maneman/ui/Button";
import { failedRequestId, useLoad } from "@maneman/ui/useLoad";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { addDays, fullDate, indiaDate, listDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import {
  api,
  type Leave,
  type Roster as RosterBook,
  type Technician,
  type TechnicianSummary,
  type TechnicianWork,
} from "../api.ts";
import { OpsLink, Shell } from "../components/Shell.tsx";
import { technicians } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { technicianPath } from "../route.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { Narrowing, SortHeads, TableEnd } from "../components/TableTools.tsx";
import { useTableView, type Column } from "../components/useTableView.ts";
import { AddTechnician } from "./TechnicianForms.tsx";
import styles from "./technicians.module.css";

/** The route's period ends the day after the last one counted; the note names that last day. */
const lastDay = (exclusiveEnd: string) => addDays(exclusiveEnd, -1);

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
  if (figures === undefined || average === null || planned === null) {
    return <span className={styles.none}>{technicians.unknown}</span>;
  }

  return (
    <>
      <span className={figures.runs_over ? styles.over : undefined}>
        {copy.average(Math.floor(average / 60), average % 60)}
      </span>
      {/* The average is of the jobs the phone timed, so it says so when that is not all of them. */}
      {figures.timed_jobs < figures.jobs && (
        <span className={styles.base}>{copy.base(figures.timed_jobs, figures.jobs)}</span>
      )}
    </>
  );
}

/** The Leave column: away today and until when, the first day of leave still to come, or a gap. */
function LeaveCell({ leave, today }: { leave: readonly Leave[]; today: string }) {
  const next = leave[0];
  if (next === undefined) return <span className={styles.none}>{technicians.unknown}</span>;
  const year = Number(today.slice(0, 4));
  if (next.from <= today)
    return <span className={capsLook(styles.away)}>{technicians.away(listDate(next.to, year))}</span>;
  return <span>{technicians.from(listDate(next.from, year))}</span>;
}

/** The technicians switched off, beneath the table: they cannot sign in, and nothing is booked on them. */
function SwitchedOff({ list }: { list: readonly TechnicianSummary[] }) {
  return (
    <section className={styles.off} aria-labelledby="switched-off">
      <h3 className={capsLook(styles.sectionTitle)} id="switched-off">
        {technicians.switchedOff}
      </h3>
      <ul className={styles.offList}>
        {list.map((technician) => (
          <li className={styles.offRow} key={technician.id}>
            <OpsLink className={styles.choose} to={technicianPath(technician.id)}>
              {technician.name}
            </OpsLink>
            <span className={styles.offZone}>{technician.zone ?? technicians.unknown}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The roster's table: the active technicians, one row each. */
function RosterTable({
  active,
  figures,
}: {
  active: readonly Technician[];
  figures: ReadonlyMap<string, TechnicianWork>;
}) {
  const today = indiaDate(new Date().toISOString());
  const zone = (row: Technician) => row.zone ?? "";
  const [name, zoneLabel, jobs, service, leave] = technicians.columns;
  const columns: readonly Column<Technician>[] = [
    { label: name, sort: (row) => row.name },
    { label: zoneLabel, sort: zone, choice: zone },
    { label: jobs, sort: (row) => figures.get(row.id)?.jobs ?? -1 },
    { label: service, sort: (row) => figures.get(row.id)?.average_minutes ?? -1 },
    { label: leave, sort: (row) => row.leave[0]?.from ?? "" },
  ];
  const view = useTableView(active, columns, { search: (row) => `${row.name} ${zone(row)}` });
  return (
    <>
      <Narrowing view={view} label={technicians.narrow} className={styles.narrow} />
      <table className={styles.table}>
        <thead>
          <tr>
            <SortHeads view={view} className={styles.head} />
          </tr>
        </thead>
        <tbody>
          {view.shown.map((technician) => (
            <tr key={technician.id}>
              <th scope="row" className={styles.name}>
                <OpsLink className={styles.choose} to={technicianPath(technician.id)}>
                  {technician.name}
                </OpsLink>
              </th>
              <td className={styles.zone}>{technician.zone ?? technicians.unknown}</td>
              <td className={styles.jobs}>{figures.get(technician.id)?.jobs ?? technicians.unknown}</td>
              <td className={styles.service}>
                <Service figures={figures.get(technician.id)} />
              </td>
              <td className={styles.leaveCell}>
                <LeaveCell leave={technician.leave} today={today} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <TableEnd view={view} />
    </>
  );
}

function Roster() {
  const [loaded, retry] = useLoad(api.technicians);
  // The roster carries no period, so the figures are a read of their own; the
  // table is one table either way, and waits for both.
  const [work, retryWork] = useLoad(api.technicianWork);
  // The roster as read again after a technician is added.
  const [fresh, setFresh] = useState<RosterBook | null>(null);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const mayAdd = useAccess().mayCall("POST /api/technicians");

  if (loaded.state === "loading" || work.state === "loading") return <Loading />;
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

  const book = fresh ?? loaded.value;
  const figures = new Map(work.value.technicians.map((each) => [each.technician_id, each]));
  const readAgain = async () => {
    const answer = await api.technicians();
    if (answer.ok) setFresh(answer.body);
  };

  return (
    <section className={styles.panel} aria-labelledby="roster">
      <VisuallyHidden as="h2" id="roster">
        {technicians.title}
      </VisuallyHidden>
      {mayAdd && (
        <div className={styles.toolbar}>
          <Button
            variant="outline"
            size="small"
            className={styles.quiet}
            onClick={() => {
              setAdded(null);
              setAdding(true);
            }}
          >
            {technicians.add.open}
          </Button>
        </div>
      )}
      {added !== null && (
        <p className={styles.notice} role="status">
          {technicians.add.added(added)}
        </p>
      )}
      {book.technicians.length === 0 ? (
        <p className={styles.empty}>{technicians.empty}</p>
      ) : (
        <RosterTable active={book.technicians} figures={figures} />
      )}
      <p className={styles.note}>
        {technicians.work.period(fullDate(work.value.from), fullDate(lastDay(work.value.to)))}
      </p>
      {book.switched_off.length > 0 && <SwitchedOff list={book.switched_off} />}
      {adding && (
        <AddTechnician
          cities={book.cities}
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
    </section>
  );
}

export function TechniciansScreen() {
  return (
    <Shell section="/technicians" title={technicians.title}>
      <Roster />
    </Shell>
  );
}
