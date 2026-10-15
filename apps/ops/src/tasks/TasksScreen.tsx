// Tasks: what ops still have to do, in groups under the department that decides each, with whose it is and how long it
// has left. A task is a row in a queue the database keeps (src/policy/tasks.ts), so it leaves when that row is decided;
// each leads to where it is done, some on the row itself (BookFromTask.tsx, PaymentLinkActions.tsx, CallAboutMove.tsx,
// TaskActions.tsx).

import { EmptyState } from "@maneman/ui/EmptyState";
import { TextButton } from "@maneman/ui/TextLink";
import { capsLook } from "@maneman/ui/Caps";
import { useLoad } from "@maneman/ui/useLoad";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import type { Task, TaskGroup, Tasks } from "../api.ts";
import { OpsLink } from "../components/Shell.tsx";
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
import { decidedAt, subjectOf, taskClientPath } from "../lib/task-links.ts";
import { NeedsAHand } from "./NeedsAHand.tsx";
import { firstOverdue, ROWS_FOLDED, sectionsOf, type TaskSection } from "./sections.ts";
import { subOf } from "./task-subs.ts";
import { TaskActions } from "./TaskActions.tsx";
import shared from "./tasks.module.css";
import styles from "./tasks-screen.module.css";
import { nameParts } from "../lib/who.ts";

type Group = TaskGroup["group"];

/** "priya.sharma@maneman.in" reads "Priya", as the board names an owner in ops by their first name. */
function ownerName(email: string): string {
  const [first = email] = nameParts(email);
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

function TaskRow({ group, task, now, acting, marked }: RowProps) {
  const subject = subjectOf(group, task);
  const where = decidedAt(group, task);
  const action = tasks.decide[group];
  const { owner } = acting;

  return (
    <li id={taskRowId(group, task.id)} tabIndex={-1} className={marked ? shared.marked : shared.task}>
      <div className={shared.what}>
        {task.person === null ? (
          <span className={shared.subject}>{subject}</span>
        ) : (
          <OpsLink className={shared.subject} to={taskClientPath(group, task.person.id)}>
            {subject}
          </OpsLink>
        )}
        <span className={shared.sub}>{subOf(task, now)}</span>
        {where !== null && action !== undefined && (
          <span className={shared.sub}>
            <OpsLink className={shared.decide} to={where}>
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
    <div className={shared.group}>
      <div className={shared.groupHead}>
        <h4 className={capsLook(shared.groupName)}>{name}</h4>
        <span className={shared.count}>{group.count}</span>
      </div>
      <ul className={shared.tasks} id={listId}>
        {shown.map(rowOf)}
      </ul>
      {folds && (
        <TextButton
          tone="muted"
          compact
          className={shared.fold}
          aria-expanded={unfolded}
          aria-controls={listId}
          onClick={onFold}
        >
          {unfolded ? tasks.fewer : tasks.more(listed - ROWS_FOLDED)}
          <VisuallyHidden>{` · ${name}`}</VisuallyHidden>
        </TextButton>
      )}
      {shown.length === listed && group.count > listed && (
        <p className={shared.shown}>{tasks.shown(listed, group.count)}</p>
      )}
    </div>
  );
}

/** A department's groups under its name and how many wait in all of them. */
function DepartmentSection({ section, children }: { section: TaskSection; children: ReactNode }) {
  return (
    <div className={shared.department}>
      <div className={shared.departmentHead}>
        <h3 className={shared.departmentName}>{tasks.departments[section.department]}</h3>
        <span className={shared.count}>{section.count}</span>
      </div>
      <div className={shared.groups}>{children}</div>
    </div>
  );
}

/** The head's count of what has run over: it takes the keyboard to the first, where one is listed. */
function OverdueCount({ count, onJump }: { count: number; onJump: (() => void) | null }) {
  if (onJump === null) return <span className={shared.overdue}>{tasks.overdue(count)}</span>;
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

function toggled(groups: ReadonlySet<Group>, group: Group): ReadonlySet<Group> {
  const next = new Set(groups);
  if (next.has(group)) next.delete(group);
  else next.add(group);
  return next;
}

function TaskQueue() {
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
        <TaskRow
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
    <section className={shared.queue} aria-labelledby="tasks">
      <div className={shared.queueHead}>
        <h2 className={shared.panelTitle} id="tasks" ref={heading} tabIndex={-1}>
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
    <div className={shared.board}>
      <NeedsAHand />
      <TaskQueue />
    </div>
  );
}
