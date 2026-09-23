// Tasks (Ops Console, board D2): what ops still have to do, in groups, with how
// long each has left. Nothing is decided here. A task is a row in a queue the
// database already keeps — a held grant, an undecided no-show, a number change,
// an erasure, a piece past its replacement date — so it leaves the list when
// that row is decided, on the section that decides it (src/policy/tasks.ts).
//
// The board writes an owner in ops against every task. Nothing records one, so
// the column is not drawn (docs/open-points.md, item 58).

import { fullDate, indiaDate, shortDate } from "@maneman/web-kit/dates";
import { api, type Task, type TaskGroup } from "../api.ts";
import { OpsLink, Shell } from "../components/Shell.tsx";
import { referrals, tasks } from "../content.ts";
import { useLoad } from "../lib/useLoad.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import styles from "./tasks.module.css";

type Group = TaskGroup["group"];

/** The fraud rules, as board C1 letters them: a held grant is the same grant on both boards. */
const SIGNALS: Readonly<Record<string, string>> = referrals.queue.signals;

/** Whole days in India from today to the day a task falls due: 0 is today, below zero is overdue. */
function daysUntil(due: string, now: Date): number {
  const midnight = (instant: string) => Date.parse(`${indiaDate(instant)}T00:00:00Z`);
  return Math.round((midnight(due) - midnight(now.toISOString())) / 86_400_000);
}

/** The second line: the one fact the group turns on. */
function subOf(group: Group, task: Task): string {
  const copy = tasks.subs;
  if (group === "replacement_order") {
    return copy.replacement_order(task.detail ?? tasks.unknown, fullDate(indiaDate(task.since)));
  }
  if (group === "referral_review") return SIGNALS[task.detail ?? ""] ?? copy.unknown;
  if (group === "no_show_decision") return task.detail === null ? copy.unknown : copy.no_show_decision(task.detail);
  return group === "number_change" ? copy.number_change : copy.erasure_request;
}

function Row({ group, task, now }: { group: Group; task: Task; now: Date }) {
  const days = daysUntil(task.due, now);
  const overdue = days < 0;
  const sla = overdue ? tasks.sla.over(-days) : days === 0 ? tasks.sla.today : tasks.sla.left(days);

  return (
    <li className={styles.task}>
      <div className={styles.what}>
        {task.person === null ? (
          // A no-show case names the technician and never the client, so its own visit heads it.
          <span className={styles.subject}>{tasks.visit(shortDate(indiaDate(task.since)))}</span>
        ) : (
          <OpsLink className={styles.subject} to={`/clients/${task.person.id}`}>
            {task.person.name}
          </OpsLink>
        )}
        <span className={styles.sub}>{subOf(group, task)}</span>
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
  const { overdue, groups } = loaded.value;
  return (
    <section className={styles.panel} aria-labelledby="tasks">
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle} id="tasks">
          {tasks.title}
        </h2>
        <span className={styles.overdue}>{tasks.overdue(overdue)}</span>
      </div>
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
