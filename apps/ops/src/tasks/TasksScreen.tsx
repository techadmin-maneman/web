// Tasks: what ops still have to do, in groups, with whose
// each is and how long it has left. Nothing is decided here. A task is a row in a queue the
// database already keeps — a consultation asked for, a held grant, an
// undecided no-show, a disputed charge, a number change, an erasure, a grievance, a piece past its
// replacement date, an invoice still a draft, a moved visit whose client has not
// heard of it, a visit left partly done, a
// visit to come with no address, a job on its technician's day off, a client
// past their next service with nothing booked, a client consulted and not
// fitted, a one visit's payment still owed — so it leaves the list when that row
// is decided, on the section that decides it, when the client books, or when
// they pay (src/policy/tasks.ts).
//
// Each task leads to where it is done: the client's page, and the row in the
// section that decides it; a task the dispatch board settles opens its visit's
// drawer there. A consultation asked for, a first fit to book and a replacement
// due are booked from the row itself (BookFromTask.tsx), a payment owed has its
// link copied or texted again there (PaymentLinkActions.tsx), and the call about a
// move is recorded there too (CallAboutMove.tsx). Each group's count is the whole
// queue's, and a group longer than the board lists says so.
//
// The groups stand under the department that decides them, in the navigation's
// order, side by side where the screen is wide enough (sections.ts). A group
// shows its five longest waits until ops ask for the rest, and the head's
// overdue count takes the keyboard to the first task past its day.
//
// The board writes an owner in ops against every task, in its own column. Ops
// take a task, give it to another member of staff or hand it back, and close a
// visit left partly done without a follow-up, from the row (TaskActions.tsx;
// docs/decisions/0092-task-owners.md).
//
// Above the tasks, "Needs a hand" lists the alerts ops were told of and not yet
// put right (NeedsAHand.tsx).

import { EmptyState } from "@maneman/ui/EmptyState";
import { TextButton } from "@maneman/ui/TextLink";
import { capsLook } from "@maneman/ui/Caps";
import { useLoad } from "@maneman/ui/useLoad";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { indiaDate, shortDate } from "@maneman/web-kit/dates";
import { useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import type { Task, TaskGroup, Tasks } from "../api.ts";
import { OpsLink, Shell } from "../components/Shell.tsx";
import { tasks } from "../content.ts";
import { taskNeed, useAccess, whoami } from "../lib/access.ts";
import { daysUntil } from "../lib/due.ts";
import { Left } from "../lib/Left.tsx";
import { readTasks } from "../lib/waiting.ts";
import { rowId } from "../lib/target.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { BookFromTask } from "./BookFromTask.tsx";
import { CallAboutMove } from "./CallAboutMove.tsx";
import { PaymentLinkActions } from "./PaymentLinkActions.tsx";
import { decidedAt, taskClientPath } from "../lib/task-links.ts";
import { NeedsAHand } from "./NeedsAHand.tsx";
import { firstOverdue, ROWS_FOLDED, sectionsOf, type TaskSection } from "./sections.ts";
import { subOf } from "./task-subs.ts";
import { TaskActions } from "./TaskActions.tsx";
import styles from "./tasks.module.css";

type Group = TaskGroup["group"];

/**
 * The first line of a task with no client to name: an erased client has no
 * name left, so the visit heads a no-show, and a disputed charge says only that.
 */
function unnamedSubject(group: Group, task: Task): string {
  if (group === "no_show_dispute") return tasks.disputeErased;
  // A chat from a number we don't know is named by the number.
  if (task.facts.group === "unanswered_chat") return task.facts.mobile;
  return tasks.visit(shortDate(indiaDate(task.since)));
}

/** "priya.sharma@maneman.in" reads "Priya", as the board names an owner in ops by their first name. */
function ownerName(email: string): string {
  const [first = email] = (email.split("@")[0] ?? email).split(/[._-]+/);
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/**
 * What the row's actions need beyond the task: who is signed in, who a task may be given to, what their access lets
 * them do with it, and what changed.
 */
interface Acting {
  readonly me: string | null;
  readonly staff: readonly string[];
  /** Whether they may take it, give it or hand it back: Act in the department that decides its group. */
  readonly mayOwn: boolean;
  /** Whether they may close it without a follow-up: a group that allows it, and access that reaches it. */
  readonly closable: boolean;
  readonly owner: string | null;
  readonly onOwner: (owner: string | null) => void;
  readonly onClosed: () => void;
}

/** The element id of a task's row, which the head's overdue count takes the keyboard to. */
const taskRowId = (group: Group, id: string): string => rowId(`task-${group}`, id);

interface RowProps {
  readonly group: Group;
  readonly task: Task;
  readonly now: Date;
  readonly acting: Acting;
  /** The row the overdue count went to, marked as a row a link lands on is. */
  readonly marked: boolean;
}

function Row({ group, task, now, acting, marked }: RowProps) {
  const subject = task.person?.name ?? unnamedSubject(group, task);
  const where = decidedAt(group, task);
  const action = tasks.decide[group];
  const { owner } = acting;

  return (
    <li id={taskRowId(group, task.id)} tabIndex={-1} className={marked ? styles.marked : styles.task}>
      <div className={styles.what}>
        {task.person === null ? (
          <span className={styles.subject}>{subject}</span>
        ) : (
          <OpsLink className={styles.subject} to={taskClientPath(group, task.person.id)}>
            {subject}
          </OpsLink>
        )}
        <span className={styles.sub}>{subOf(task, now)}</span>
        {where !== null && action !== undefined && (
          <span className={styles.sub}>
            <OpsLink className={styles.decide} to={where}>
              {action}
              {/* Every row of a group links the same words, so each says whose it is to a screen reader. */}
              <VisuallyHidden>{` · ${subject}`}</VisuallyHidden>
            </OpsLink>
          </span>
        )}
        <BookFromTask task={task} subject={subject} onBooked={acting.onClosed} />
        {group === "payment_owed" && <PaymentLinkActions task={task} subject={subject} />}
        <CallAboutMove group={group} task={task} subject={subject} onTold={acting.onClosed} />
        <TaskActions group={group} task={task} subject={subject} {...acting} />
      </div>
      <span className={styles.owner}>
        <VisuallyHidden>{tasks.owner.label}</VisuallyHidden>
        {owner === null ? <VisuallyHidden>{tasks.owner.nobody}</VisuallyHidden> : ownerName(owner)}
      </span>
      <span className={styles.due}>
        <Left due={task.due} now={now} />
      </span>
    </li>
  );
}

interface GroupProps {
  readonly group: TaskGroup;
  readonly unfolded: boolean;
  readonly onFold: () => void;
  readonly rowOf: (task: Task) => ReactNode;
}

/** One group: its name and whole count, its longest waits, and the rest once ops ask for them. */
function GroupCard({ group, unfolded, onFold, rowOf }: GroupProps) {
  const listed = group.tasks.length;
  const folds = listed > ROWS_FOLDED;
  const shown = folds && !unfolded ? group.tasks.slice(0, ROWS_FOLDED) : group.tasks;
  const name = tasks.groups[group.group];
  const listId = `group-${group.group}`;

  return (
    <div className={styles.group}>
      <div className={styles.groupHead}>
        <h4 className={capsLook(styles.groupName)}>{name}</h4>
        <span className={styles.count}>{group.count}</span>
      </div>
      <ul className={styles.tasks} id={listId}>
        {shown.map(rowOf)}
      </ul>
      {folds && (
        <TextButton
          tone="muted"
          compact
          className={styles.fold}
          aria-expanded={unfolded}
          aria-controls={listId}
          onClick={onFold}
        >
          {unfolded ? tasks.fewer : tasks.more(listed - ROWS_FOLDED)}
          <VisuallyHidden>{` · ${name}`}</VisuallyHidden>
        </TextButton>
      )}
      {shown.length === listed && group.count > listed && (
        <p className={styles.shown}>{tasks.shown(listed, group.count)}</p>
      )}
    </div>
  );
}

/** A department's groups under its name and how many wait in all of them. */
function DepartmentSection({ section, children }: { section: TaskSection; children: ReactNode }) {
  return (
    <div className={styles.department}>
      <div className={styles.departmentHead}>
        <h3 className={styles.departmentName}>{tasks.departments[section.department]}</h3>
        <span className={styles.count}>{section.count}</span>
      </div>
      <div className={styles.groups}>{children}</div>
    </div>
  );
}

/** The head's count of what has run over: it takes the keyboard to the first, where one is listed. */
function OverdueCount({ count, onJump }: { count: number; onJump: (() => void) | null }) {
  if (onJump === null) return <span className={styles.overdue}>{tasks.overdue(count)}</span>;
  return (
    <TextButton tone="danger" compact aria-label={tasks.overdueJump(count)} onClick={onJump}>
      {tasks.overdue(count)}
    </TextButton>
  );
}

/** A task by its group and its row's id, as the API names it. */
const keyOf = (group: Group, id: string) => `${group}/${id}`;

/**
 * The board as it was read, less the tasks closed here since, with their groups' counts and the overdue count: the
 * list follows what ops close on it without being read again.
 */
function sinceRead(board: Tasks, closed: readonly string[], now: Date): Tasks {
  const groups = board.groups
    .map((each) => {
      const left = each.tasks.filter((task) => !closed.includes(keyOf(each.group, task.id)));
      return { ...each, count: each.count - (each.tasks.length - left.length), tasks: left };
    })
    .filter((each) => each.count > 0);
  const closedOverdue = board.groups.flatMap((each) =>
    each.tasks.filter((task) => closed.includes(keyOf(each.group, task.id)) && daysUntil(task.due, now) < 0),
  );
  return { ...board, overdue: board.overdue - closedOverdue.length, groups };
}

/** The set with the group in it if it was not, and without it if it was. */
function toggled(groups: ReadonlySet<Group>, group: Group): ReadonlySet<Group> {
  const next = new Set(groups);
  if (next.has(group)) next.delete(group);
  else next.add(group);
  return next;
}

function Queue() {
  const [loaded, retry] = useLoad(readTasks);
  const [signedIn] = useLoad(whoami);
  const access = useAccess();
  const [owners, setOwners] = useState<ReadonlyMap<string, string | null>>(new Map());
  const [closed, setClosed] = useState<readonly string[]>([]);
  const [unfolded, setUnfolded] = useState<ReadonlySet<Group>>(new Set());
  const [marked, setMarked] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;

  const now = new Date();
  const me = signedIn.state === "loaded" ? signedIn.value.signed_in_as : null;
  const { overdue, truncated, staff, groups } = sinceRead(loaded.value, closed, now);
  const sections = sectionsOf(groups);
  const first = firstOverdue(sections, now);

  const goToFirstOverdue = () => {
    if (first === null) return;
    // The row must be drawn before it can take the keyboard: its group unfolds first if it is past the fold.
    flushSync(() => {
      if (first.index >= ROWS_FOLDED) setUnfolded((was) => new Set(was).add(first.group));
      setMarked(keyOf(first.group, first.id));
    });
    const row = document.getElementById(taskRowId(first.group, first.id));
    row?.scrollIntoView({ block: "center" });
    row?.focus();
  };

  const actingOn = (group: TaskGroup, task: Task): Acting => {
    const key = keyOf(group.group, task.id);
    const changed = owners.get(key);
    return {
      me,
      staff,
      mayOwn: access.reaches(taskNeed(group.group, "act")),
      closable: group.closable && access.mayCall("POST /api/tasks/{group}/{id}/close"),
      owner: changed === undefined ? task.owner : changed,
      onOwner: (owner) => {
        setOwners((was) => new Map(was).set(key, owner));
      },
      onClosed: () => {
        setClosed((was) => [...was, key]);
        // The row is gone, so the keyboard goes to the list's heading rather than to the top of the page.
        heading.current?.focus();
      },
    };
  };

  const groupCard = (group: TaskGroup) => (
    <GroupCard
      key={group.group}
      group={group}
      unfolded={unfolded.has(group.group)}
      onFold={() => {
        setUnfolded((was) => toggled(was, group.group));
      }}
      rowOf={(task) => (
        <Row
          key={task.id}
          group={group.group}
          task={task}
          now={now}
          acting={actingOn(group, task)}
          marked={marked === keyOf(group.group, task.id)}
        />
      )}
    />
  );

  return (
    <section className={styles.queue} aria-labelledby="tasks">
      <div className={styles.queueHead}>
        {/* The bar above names the page; the list says how much is open, beside how much is late. */}
        <h2 className={styles.panelTitle} id="tasks" ref={heading} tabIndex={-1}>
          {tasks.openCount(groups.reduce((sum, group) => sum + group.count, 0))}
        </h2>
        <OverdueCount count={overdue} onJump={first === null ? null : goToFirstOverdue} />
      </div>
      {truncated && <p className={styles.note}>{tasks.truncated}</p>}
      {sections.length === 0 ? (
        <EmptyState look="panel" line={tasks.empty} />
      ) : (
        sections.map((section) => (
          <DepartmentSection key={section.department} section={section}>
            {section.groups.map(groupCard)}
          </DepartmentSection>
        ))
      )}
    </section>
  );
}

export function TasksScreen() {
  return (
    <Shell section="/tasks" title={tasks.title}>
      <div className={styles.board}>
        <NeedsAHand />
        <Queue />
      </div>
    </Shell>
  );
}
