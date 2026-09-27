// Tasks (Ops Console, board D2): what ops still have to do, in groups, with how
// long each has left. Nothing is decided here. A task is a row in a queue the
// database already keeps — a consultation asked for, a held grant, an
// undecided no-show, a number change, an erasure, a grievance, a piece past its
// replacement date, an invoice still a draft, an erasure FSM would not finish,
// a moved visit whose client has not heard of it, a visit left partly done, a
// visit to come with no address, a job on its technician's day off — so it leaves the list when
// that row is decided, on the section that decides it (src/policy/tasks.ts).
//
// Each task leads to where it is done: the client's page, and the row in the
// section that decides it. Each group's count is the whole queue's, and a group
// longer than the board lists says so.
//
// The board writes an owner in ops against every task. Nothing records one, so
// the column is not drawn (docs/open-points.md, item 61).

import { useLoad } from "@maneman/ui/useLoad";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { fullDate, indiaClock, indiaDate, shortDate } from "@maneman/web-kit/dates";
import { api, type Task, type TaskGroup } from "../api.ts";
import { OpsLink, Shell } from "../components/Shell.tsx";
import { dispatch, referrals, tasks } from "../content.ts";
import { daysUntil } from "../lib/due.ts";
import { rowPath } from "../lib/target.ts";
import type { ClientTab } from "../route.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import styles from "./tasks.module.css";

type Group = TaskGroup["group"];

/** The fraud rules, as board C1 letters them: a held grant is the same grant on both boards. */
const SIGNALS: Readonly<Record<string, string>> = referrals.queue.signals;

/**
 * Where each group's task is decided: the section, and the kind of row the
 * task's id names there. A group missing here is done outside the console
 * (in FSM or Books), and reaches only the client's page.
 */
const DECIDED_IN: Partial<Record<Group, { readonly page: string; readonly row: string | null }>> = {
  // The dispatch board draws a week, not a list, so the call is recorded, and the job moved, from its own block.
  untold_move: { page: "/dispatch", row: null },
  leave_conflict: { page: "/dispatch", row: null },
  referral_review: { page: "/referrals", row: "held" },
  no_show_decision: { page: "/no-shows", row: "case" },
  number_change: { page: "/number-changes", row: "change" },
  erasure_request: { page: "/deletion-requests", row: "request" },
  grievance: { page: "/grievances", row: "grievance" },
};

/** The tab of the client's page each group is about; the page opens on Pieces otherwise. */
const CLIENT_TAB: Partial<Record<Group, ClientTab>> = {
  untold_move: "visits",
  leave_conflict: "visits",
  address_to_confirm: "visits",
  consultation_request: "visits",
  replacement_order: "pieces",
  partial_visit: "visits",
  no_show_decision: "visits",
  draft_invoice: "payments",
};

function decidedAt(group: Group, task: Task): string | null {
  const where = DECIDED_IN[group];
  if (where === undefined) return null;
  return where.row === null ? where.page : rowPath(where.page, where.row, task.id);
}

function clientPath(group: Group, personId: string): string {
  const tab = CLIENT_TAB[group];
  return tab === undefined ? `/clients/${personId}` : `/clients/${personId}/${tab}`;
}

/** The second line: the one fact the group turns on. */
function subOf(group: Group, task: Task): string {
  const copy = tasks.subs;
  if (group === "untold_move") {
    // The start the visit moved to.
    return task.detail === null
      ? tasks.unknown
      : copy.untold_move(`${shortDate(indiaDate(task.detail))}, ${indiaClock(task.detail)}`);
  }
  if (group === "leave_conflict") {
    // The job's start, then the technician who is away that day.
    const [start = "", ...technician] = task.detail?.split(" ") ?? [];
    if (start === "") return tasks.unknown;
    return copy.leave_conflict(`${shortDate(indiaDate(start))}, ${indiaClock(start)}`, technician.join(" "));
  }
  if (group === "address_to_confirm") {
    // The visit's start.
    return task.detail === null
      ? tasks.unknown
      : copy.address_to_confirm(`${shortDate(indiaDate(task.detail))}, ${indiaClock(task.detail)}`);
  }
  if (group === "consultation_request") {
    // The day and the window, as the request recorded them: both are always there.
    const [day = "", when = ""] = task.detail?.split(" ") ?? [];
    return copy.consultation_request(fullDate(indiaDate(day)), dispatch.windows[when] ?? when);
  }
  if (group === "replacement_order") {
    return copy.replacement_order(task.detail ?? tasks.unknown, fullDate(indiaDate(task.since)));
  }
  if (group === "partial_visit") {
    // The technician's reason, and the day he closed the visit.
    const reason = copy.partialReasons[task.detail ?? ""] ?? copy.noReason;
    return copy.partial_visit(reason, shortDate(indiaDate(task.since)));
  }
  if (group === "referral_review") return SIGNALS[task.detail ?? ""] ?? copy.unknown;
  if (group === "no_show_decision") return task.detail === null ? copy.unknown : copy.no_show_decision(task.detail);
  if (group === "draft_invoice") return copy.draft_invoice(shortDate(indiaDate(task.since)));
  if (group === "erasure_unfinished") return copy.erasure_unfinished(task.detail ?? tasks.unknown);
  if (group === "grievance") return copy.grievance;
  return group === "number_change" ? copy.number_change : copy.erasure_request;
}

/**
 * The first line of a task with no client to name: an erased client has no
 * name left, so the day they were erased heads an erasure FSM would not
 * finish, and the visit heads a no-show.
 */
function unnamedSubject(group: Group, task: Task): string {
  const day = shortDate(indiaDate(task.since));
  return group === "erasure_unfinished" ? tasks.erased(day) : tasks.visit(day);
}

/** How long is left to answer: the days over, today, or the days left. */
function slaText(days: number): string {
  if (days < 0) return tasks.sla.over(-days);
  if (days === 0) return tasks.sla.today;
  return tasks.sla.left(days);
}

function Row({ group, task, now }: { group: Group; task: Task; now: Date }) {
  const days = daysUntil(task.due, now);
  const overdue = days < 0;
  const sla = slaText(days);
  const subject = task.person?.name ?? unnamedSubject(group, task);
  const where = decidedAt(group, task);
  const action = tasks.decide[group];

  return (
    <li className={styles.task}>
      <div className={styles.what}>
        {task.person === null ? (
          <span className={styles.subject}>{subject}</span>
        ) : (
          <OpsLink className={styles.subject} to={clientPath(group, task.person.id)}>
            {subject}
          </OpsLink>
        )}
        <span className={styles.sub}>{subOf(group, task)}</span>
        {where !== null && action !== undefined && (
          <span className={styles.sub}>
            <OpsLink className={styles.decide} to={where}>
              {action}
              {/* Every row of a group links the same words, so each says whose it is to a screen reader. */}
              <VisuallyHidden>{` · ${subject}`}</VisuallyHidden>
            </OpsLink>
          </span>
        )}
      </div>
      <span className={`${styles.sla ?? ""} ${overdue ? (styles.late ?? "") : ""}`}>{sla}</span>
    </li>
  );
}

function Queue() {
  const [loaded, retry] = useLoad(api.tasks);

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} />;

  const now = new Date();
  const { overdue, truncated, groups } = loaded.value;
  return (
    <section className={styles.panel} aria-labelledby="tasks">
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle} id="tasks">
          {tasks.title}
        </h2>
        <span className={styles.overdue}>{tasks.overdue(overdue)}</span>
      </div>
      {truncated && <p className={styles.note}>{tasks.truncated}</p>}
      {groups.length === 0 ? (
        <p className={styles.empty}>{tasks.empty}</p>
      ) : (
        groups.map((group) => (
          <div className={styles.group} key={group.group}>
            <div className={styles.groupHead}>
              <h3 className={styles.groupName}>{tasks.groups[group.group]}</h3>
              <span className={styles.count}>{group.count}</span>
            </div>
            <ul className={styles.tasks}>
              {group.tasks.map((task) => (
                <Row key={task.id} group={group.group} task={task} now={now} />
              ))}
            </ul>
            {group.count > group.tasks.length && (
              <p className={styles.shown}>{tasks.shown(group.tasks.length, group.count)}</p>
            )}
          </div>
        ))
      )}
      <p className={styles.note}>{tasks.note}</p>
    </section>
  );
}

export function TasksScreen() {
  return (
    <Shell section="/tasks" title={tasks.title}>
      <div className={styles.column}>
        <Queue />
      </div>
    </Shell>
  );
}
