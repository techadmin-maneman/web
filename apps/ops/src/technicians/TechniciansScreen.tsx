// Technicians: who works, their city, and the jobs they have finished and how those ran, one row each. Nothing records
// a technician's skills, so Leave stands in the design's Skill column (docs/open-points.md, item 59). A name opens
// their page (./TechnicianScreen.tsx); they are added here (./TechnicianForms.tsx).

import { typeLook } from "@maneman/ui/type";
import { classes } from "@maneman/ui/classes";
import { EmptyState } from "@maneman/ui/EmptyState";
import { Table } from "@maneman/ui/Table";
import { capsLook } from "@maneman/ui/Caps";
import { Button } from "@maneman/ui/Button";
import { failedRequestId, useLoad } from "@maneman/ui/useLoad";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { addDays, fullDate, listDate, todayInIndia } from "@maneman/web-kit/dates";
import { useState } from "react";
import {
  type Leave,
  type Roster as RosterBook,
  type Technician,
  type TechnicianSummary,
  type TechnicianWork,
} from "../api.ts";
import { OpsLink } from "../components/Shell.tsx";
import { PageActions, useHeaderSub } from "../components/PageHead.tsx";
import { tables, technicians } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { technicianPath } from "../route.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { Narrowing, SortHeads, TableEnd } from "../components/TableTools.tsx";
import { useTableView, type Column } from "../components/useTableView.ts";
import { AddTechnician } from "./TechnicianForms.tsx";
import shared from "./technicians.module.css";
import styles from "./technicians-screen.module.css";
import { techniciansApi } from "./technicians-api.ts";

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
  // Under a minute is a job closed as it was started, not a visit's length.
  if (figures === undefined || average === null || planned === null || average < 1) {
    return <span className={shared.none}>{technicians.unknown}</span>;
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

/** The Leave column: away today and until when, the first day of leave still to come, or a gap. */
function LeaveCell({ leave, today }: { leave: readonly Leave[]; today: string }) {
  const next = leave[0];
  if (next === undefined) return <span className={shared.none}>{technicians.unknown}</span>;
  const year = Number(today.slice(0, 4));
  if (next.from <= today)
    return <span className={capsLook(shared.away)}>{technicians.away(listDate(next.to, year))}</span>;
  return <span>{technicians.from(listDate(next.from, year))}</span>;
}

/** The technicians switched off, beneath the table: they cannot sign in, and nothing is booked on them. */
function SwitchedOff({ list }: { list: readonly TechnicianSummary[] }) {
  return (
    <section className={shared.off} aria-labelledby="switched-off">
      <h3 className={typeLook("title-4", shared.sectionTitle)} id="switched-off">
        {technicians.switchedOff}
      </h3>
      <ul className={shared.offList}>
        {list.map((technician) => (
          <li className={styles.offRow} key={technician.id}>
            <OpsLink className={shared.choose} to={technicianPath(technician.id)}>
              {technician.name}
            </OpsLink>
            <span className={shared.offZone}>{technician.city ?? technicians.unknown}</span>
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
  const today = todayInIndia(Date.now());
  const city = (row: Technician) => row.city ?? "";
  const [name, cityLabel, jobs, service, leave] = technicians.columns;
  const columns: readonly Column<Technician>[] = [
    { label: name, sort: (row) => row.name },
    { label: cityLabel, sort: city, choice: city, all: tables.allCities },
    { label: jobs, sort: (row) => figures.get(row.id)?.jobs ?? -1 },
    { label: service, sort: (row) => figures.get(row.id)?.average_minutes ?? -1 },
    { label: leave, sort: (row) => row.leave[0]?.from ?? "" },
  ];
  const view = useTableView(active, columns, { search: (row) => `${row.name} ${city(row)}` });
  return (
    <>
      <Narrowing view={view} label={technicians.narrow} className={styles.narrow} />
      <Table className={styles.table}>
        <thead>
          <tr>
            <SortHeads view={view} className={shared.head} />
          </tr>
        </thead>
        <tbody>
          {view.shown.map((technician) => (
            <tr key={technician.id}>
              <th scope="row" className={shared.name}>
                <OpsLink className={shared.choose} to={technicianPath(technician.id)}>
                  {technician.name}
                </OpsLink>
              </th>
              <td className={classes(shared.city, technician.city === null && shared.noCity)}>
                {technician.city ?? technicians.noCity}
              </td>
              <td className={shared.jobs}>{figures.get(technician.id)?.jobs ?? technicians.unknown}</td>
              <td className={shared.service}>
                <Service figures={figures.get(technician.id)} />
              </td>
              <td className={shared.leaveCell}>
                <LeaveCell leave={technician.leave} today={today} />
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <TableEnd view={view} />
    </>
  );
}

/** The days the figures count, beside the page's title. */
function Period({ from, to }: { from: string; to: string }) {
  useHeaderSub(technicians.work.period(fullDate(from), fullDate(lastDay(to))));
  return null;
}

function Roster() {
  const [loaded, retry] = useLoad(techniciansApi.technicians);
  // The roster carries no period, so the figures are a read of their own; the
  // table is one table either way, and waits for both.
  const [work, retryWork] = useLoad(techniciansApi.technicianWork);
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

  const roster = fresh ?? loaded.value;
  const figures = new Map(work.value.technicians.map((each) => [each.technician_id, each]));
  const readAgain = async () => {
    const answer = await techniciansApi.technicians();
    if (answer.ok) setFresh(answer.body);
  };

  return (
    <section className={shared.panel} aria-labelledby="roster">
      <VisuallyHidden as="h2" id="roster">
        {technicians.title}
      </VisuallyHidden>
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
      {added !== null && (
        <p className={shared.notice} role="status">
          {technicians.add.added(added)}
        </p>
      )}
      {roster.technicians.length === 0 ? (
        <EmptyState look="panel" line={technicians.empty} />
      ) : (
        <RosterTable active={roster.technicians} figures={figures} />
      )}
      {roster.switched_off.length > 0 && <SwitchedOff list={roster.switched_off} />}
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
    </section>
  );
}

export function TechniciansScreen() {
  return <Roster />;
}
