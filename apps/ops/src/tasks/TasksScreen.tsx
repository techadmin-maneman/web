// Tasks: what ops still have to do, a card each in groups under the department that decides each, with whose it is and
// how long it has left. A task is a row in a queue the database keeps (src/policy/tasks.ts), so it leaves when that row
// is decided; each card leads to where it is done, and its Details open a drawer with all else done on it here
// (./TaskDetail.tsx).

import { EmptyState } from "@maneman/ui/EmptyState";
import { TabButton, Tabs } from "@maneman/ui/Tabs";
import { TextButton } from "@maneman/ui/TextLink";
import { capsLook } from "@maneman/ui/Caps";
import { useLoad } from "@maneman/ui/useLoad";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import type { Task, TaskGroup, Tasks } from "../api.ts";
import { OpsLink } from "../components/Shell.tsx";
import { PageActions, useHeaderSub } from "../components/PageHead.tsx";
import { needsAHand, tasks } from "../content.ts";
import { taskNeed, useAccess, whoami } from "../lib/access.ts";
import { daysUntil } from "../lib/due.ts";
import { Left } from "../lib/Left.tsx";
import { readTasks } from "../lib/waiting.ts";
import { api } from "../api.ts";
import { rowId } from "../lib/target.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { subjectOf, taskClientPath } from "../lib/task-links.ts";
import { NeedsAHand } from "./NeedsAHand.tsx";
import { narrowed, NO_FILTER, TaskFilters, type TaskFilter } from "./TaskFilters.tsx";
import { firstOverdue, ROWS_FOLDED, sectionsOf, type TaskSection } from "./sections.ts";
import { subOf } from "./task-subs.ts";
import { DecideLink, ownerName, TaskDetail, type Acting } from "./TaskDetail.tsx";
import { BookFromTask } from "./BookFromTask.tsx";
import shared from "./tasks.module.css";
import styles from "./tasks-screen.module.css";

type Group = TaskGroup["group"];

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

/**
 * A task's card: what it is, its one action (where it is decided, or a booking) and its Details; whose it is; and when
 * it is due.
 */
function TaskRow({ group, task, now, acting, marked }: RowProps) {
  const subject = subjectOf(group, task);
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
        <span className={shared.cardActions}>
          <DecideLink group={group} task={task} subject={subject} />
          <BookFromTask task={task} subject={subject} onBooked={acting.onClosed} />
          <TaskDetail group={group} task={task} subject={subject} now={now} acting={acting} />
        </span>
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

/** What the board is narrowed to, and who is asking, for Mine. */
interface Filter {
  readonly by: TaskFilter;
  readonly me: string | null;
}

/**
 * The board as it was read, less the tasks closed here since, with their groups' counts and the overdue count, narrowed
 * as asked: the list follows what ops close on it without being read again.
 */
function sinceRead(board: Tasks, closed: readonly string[], now: Date, filter: Filter): Tasks & { open: number } {
  const groups = board.groups
    .map((each) => {
      const left = each.tasks.filter((task) => !closed.includes(keyOf(each.group, task.id)));
      return { ...each, count: each.count - (each.tasks.length - left.length), tasks: left };
    })
    .filter((each) => each.count > 0);
  const shown = narrowed(groups, filter.by, filter.me);
  const closedOverdue = board.groups.flatMap((each) =>
    each.tasks.filter((task) => closed.includes(keyOf(each.group, task.id)) && daysUntil(task.due, now) < 0),
  );
  const open = shown.reduce((sum, group) => sum + group.count, 0);
  return { ...board, overdue: board.overdue - closedOverdue.length, groups: shown, open };
}

function toggled(groups: ReadonlySet<Group>, group: Group): ReadonlySet<Group> {
  const next = new Set(groups);
  if (next.has(group)) next.delete(group);
  else next.add(group);
  return next;
}

/** The board, read with the tasks lapsed off it or without, and the switch between the two. */
function useBoard() {
  const [withLapsed, setWithLapsed] = useState(false);
  const read = useCallback(() => (withLapsed ? api.tasksWithLapsed() : readTasks()), [withLapsed]);
  const [loaded, retry] = useLoad(read);
  const toggle = () => {
    setWithLapsed((was) => !was);
  };
  return { loaded, retry, lapsed: { shown: withLapsed, toggle } };
}

/** What the board leaves out: more than one look reads, and the tasks lapsed off it, with a way to show them. */
function BoardNotes(props: { truncated: boolean; lapsed: number; shown: boolean; onToggle: () => void }) {
  return (
    <>
      {props.truncated && <p className={styles.note}>{tasks.truncated}</p>}
      {(props.lapsed > 0 || props.shown) && (
        <p className={styles.note}>
          {props.shown ? null : <>{tasks.lapsed(props.lapsed)} </>}
          <TextButton tone="muted" compact onClick={props.onToggle}>
            {props.shown ? tasks.hideLapsed : tasks.showLapsed}
          </TextButton>
        </p>
      )}
    </>
  );
}

/** What the queue is given: the alerts counted beside it, where to say how many are open, and what it is narrowed to. */
interface QueueProps {
  readonly alerts: number;
  readonly onOpen: (count: number) => void;
  readonly filter: TaskFilter;
}

function TaskQueue({ alerts, onOpen, filter }: QueueProps) {
  const { loaded, retry, lapsed } = useBoard();
  const [signedIn] = useLoad(whoami);
  const access = useAccess();
  const [owners, setOwners] = useState<ReadonlyMap<string, string | null>>(new Map());
  const [closed, setClosed] = useState<readonly string[]>([]);
  const [unfolded, setUnfolded] = useState<ReadonlySet<Group>>(new Set());
  const [marked, setMarked] = useState<string | null>(null);
  const heading = useRef<HTMLElement>(null);

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;

  const now = new Date();
  const me = signedIn.state === "loaded" ? signedIn.value.signed_in_as : null;
  const { overdue, truncated, staff, groups, open } = sinceRead(loaded.value, closed, now, { by: filter, me });
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
        // The row is gone, so the keyboard goes to the list rather than to the top of the page.
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

  const head = { open, alerts, overdue, onOpen, onJump: first === null ? null : goToFirstOverdue };
  return (
    <section className={shared.queue} aria-labelledby="tasks" ref={heading} tabIndex={-1}>
      <QueueHead {...head} />
      <VisuallyHidden as="h2" id="tasks">
        {tasks.openCount(open)}
      </VisuallyHidden>
      <BoardNotes truncated={truncated} lapsed={loaded.value.lapsed} shown={lapsed.shown} onToggle={lapsed.toggle} />
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

/** How many are open, beside the page's title, and how many have run over, among its actions. */
function QueueHead({
  open,
  alerts,
  overdue,
  onJump,
  onOpen,
}: {
  open: number;
  /** The alerts in their own tab, counted beside the tasks. */
  alerts: number;
  overdue: number;
  onJump: (() => void) | null;
  /** Tells the page how many are open, for its Tasks tab. */
  onOpen: (count: number) => void;
}) {
  useHeaderSub(tasks.openWithAlerts(open, alerts));
  useEffect(() => {
    onOpen(open);
  }, [open, onOpen]);
  if (overdue === 0) return null;
  return (
    <PageActions>
      <OverdueCount count={overdue} onJump={onJump} />
    </PageActions>
  );
}

/** Tasks and alerts apart: the work people do first, what the system needs a hand with a tab away. */
export function TasksScreen() {
  const [alerts, setAlerts] = useState(0);
  const [open, setOpen] = useState(0);
  const [view, setView] = useState<"tasks" | "alerts">("tasks");
  const [filter, setFilter] = useState<TaskFilter>(NO_FILTER);
  const views = needsAHand.views;
  return (
    <div className={shared.board}>
      {alerts > 0 && (
        <Tabs label={views.label}>
          <TabButton
            current={view === "tasks"}
            onClick={() => {
              setView("tasks");
            }}
          >
            {views.tasks(open)}
          </TabButton>
          <TabButton
            current={view === "alerts"}
            onClick={() => {
              setView("alerts");
            }}
          >
            {views.alerts(alerts)}
          </TabButton>
        </Tabs>
      )}
      <div hidden={view !== "alerts" || alerts === 0}>
        <NeedsAHand onCount={setAlerts} />
      </div>
      <div className={shared.board} hidden={view === "alerts" && alerts > 0}>
        <TaskFilters filter={filter} onFilter={setFilter} />
        <TaskQueue alerts={alerts} onOpen={setOpen} filter={filter} />
      </div>
    </div>
  );
}
