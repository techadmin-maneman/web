// Tasks (ADR 0227): one table of every task the person's access reaches, the longest overdue first, narrowed to their
// own, nobody's or the overdue, one kind or a client. A task is a row in a queue the database keeps
// (src/policy/tasks.ts), so it leaves when that row is decided. A row opens its drawer (./TaskDetail.tsx) and ends with
// its step (./RowStep.tsx); on a phone the rows are a list.

import { EmptyState } from "@maneman/ui/EmptyState";
import { ListRow, ListRows } from "@maneman/ui/ListRow";
import { NoValue } from "@maneman/ui/NoValue";
import { Panel } from "@maneman/ui/Panel";
import { PanelFailed, PanelLoading } from "@maneman/ui/States";
import { RowOpener, rowRule, Table } from "@maneman/ui/Table";
import { TabButton, Tabs } from "@maneman/ui/Tabs";
import { TextButton } from "@maneman/ui/TextLink";
import { useLoad } from "@maneman/ui/useLoad";
import { apiNow } from "@maneman/web-kit/clock";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Tasks } from "../api.ts";
import { needsAHand, tasks } from "../content.ts";
import { useHeaderSub } from "../frame/PageHead.tsx";
import { OpsLink } from "../frame/Shell.tsx";
import { taskNeed, useAccess, whoami } from "../lib/access.ts";
import { dueRule } from "../lib/due.ts";
import { Left } from "../lib/Left.tsx";
import { useIsPhone } from "../lib/media.ts";
import { subjectOf, taskClientPath } from "../lib/task-links.ts";
import { useCity } from "../lib/city.ts";
import { readTasks } from "../lib/waiting.ts";
import { NeedsAHand } from "./NeedsAHand.tsx";
import { RowStep } from "./RowStep.tsx";
import { ownerName, TaskDrawer, type Acting } from "./TaskDetail.tsx";
import { TaskFilters } from "./TaskFilters.tsx";
import { narrowed, NO_FILTER, type Row, type TaskFilter } from "./task-views.ts";
import { subOf } from "./task-subs.ts";
import styles from "./tasks-screen.module.css";

/** As many as one look down the table takes in; the rest once ops ask for them. */
const SHOWN_FIRST = 50;

/** A task by its group and its row's id, as the API names it. */
const keyOf = (row: Pick<Row, "group" | "task">) => `${row.group}/${row.task.id}`;

/** The board, read with the tasks lapsed off it or without, and the switch between the two. */
function useBoard() {
  const [withLapsed, setWithLapsed] = useState(false);
  const { city } = useCity();
  const read = useCallback(() => (withLapsed ? api.tasksWithLapsed(city) : readTasks(city)), [withLapsed, city]);
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

/** Every task on the board not closed here since, whose it is now, the longest overdue first. */
function rowsOf(board: Tasks, closed: readonly string[], owners: ReadonlyMap<string, string | null>): Row[] {
  return board.groups
    .flatMap((group) =>
      group.tasks.map((task) => {
        const changed = owners.get(keyOf({ group: group.group, task }));
        return { group: group.group, task, owner: changed === undefined ? task.owner : changed };
      }),
    )
    .filter((row) => !closed.includes(keyOf(row)))
    .sort((one, other) => Date.parse(one.task.due) - Date.parse(other.task.due));
}

interface Listed {
  readonly rows: readonly Row[];
  readonly now: Date;
  readonly onOpen: (row: Row) => void;
  readonly onBooked: (row: Row) => void;
  readonly actingOn: (row: Row) => Acting;
}

function TaskTable({ rows, now, onOpen, onBooked, actingOn }: Listed) {
  const columns = tasks.columns;
  return (
    <Table fixed className={styles.table}>
      <thead>
        <tr>
          <th scope="col">{columns.what}</th>
          <th scope="col">{columns.who}</th>
          <th scope="col">{columns.due}</th>
          <th scope="col">{columns.owner}</th>
          <th scope="col" />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const { group, task } = row;
          const subject = subjectOf(group, task);
          const sub = subOf(task, now);
          return (
            <tr key={keyOf(row)} className={rowRule(dueRule(task.due, now))}>
              <th scope="row">
                <RowOpener
                  meta={sub === "" ? undefined : sub}
                  onOpen={() => {
                    onOpen(row);
                  }}
                >
                  {tasks.groups[group]}
                </RowOpener>
              </th>
              <td>
                {task.person === null ? (
                  subject
                ) : (
                  <OpsLink to={taskClientPath(group, task.person.id)}>{subject}</OpsLink>
                )}
              </td>
              <td>
                <Left due={task.due} now={now} />
              </td>
              <td>{row.owner === null ? <NoValue /> : ownerName(row.owner)}</td>
              <td className={styles.step}>
                <RowStep row={row} subject={subject} acting={actingOn(row)} onBooked={onBooked} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

function TaskList({ rows, now, onOpen }: Listed) {
  return (
    <ListRows inPanel>
      {rows.map((row) => {
        const subject = subjectOf(row.group, row.task);
        const sub = subOf(row.task, now);
        return (
          <ListRow
            key={keyOf(row)}
            title={tasks.groups[row.group]}
            meta={sub === "" ? subject : `${subject} · ${sub}`}
            end={<Left due={row.task.due} now={now} />}
            endTone="plain"
            rule={dueRule(row.task.due, now)}
            onClick={() => {
              onOpen(row);
            }}
          />
        );
      })}
    </ListRows>
  );
}

/** The way to the rows past the first fifty, and back; nothing where there are no more. */
function MoreRows({ found, all, onToggle }: { found: number; all: boolean; onToggle: (all: boolean) => void }) {
  if (found <= SHOWN_FIRST) return null;
  return (
    <p className={styles.more}>
      <TextButton
        tone="muted"
        compact
        onClick={() => {
          onToggle(!all);
        }}
      >
        {all ? tasks.fewer : tasks.more(found - SHOWN_FIRST)}
      </TextButton>
    </p>
  );
}

/** How many are open, beside the page's title, told to the page for its Tasks tab. */
function useOpenCount(open: number, alerts: number, onOpen: (count: number) => void): void {
  useHeaderSub(tasks.openWithAlerts(open, alerts));
  useEffect(() => {
    onOpen(open);
  }, [open, onOpen]);
}

/** What the queue is given: the alerts counted beside it, where to say how many are open, and what it is narrowed to. */
interface QueueProps {
  readonly alerts: number;
  readonly onOpen: (count: number) => void;
  readonly filter: TaskFilter;
  readonly onFilter: (filter: TaskFilter) => void;
}

function TaskQueue({ alerts, onOpen, filter, onFilter }: QueueProps) {
  const { loaded, retry, lapsed } = useBoard();
  const [signedIn] = useLoad(whoami);
  const access = useAccess();
  const phone = useIsPhone();
  const [owners, setOwners] = useState<ReadonlyMap<string, string | null>>(new Map());
  const [closed, setClosed] = useState<readonly string[]>([]);
  const [opened, setOpened] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const board = loaded.state === "loaded" ? loaded.value : null;
  const open = board === null ? 0 : board.groups.reduce((sum, group) => sum + group.count, 0) - closed.length;
  useOpenCount(open, alerts, onOpen);

  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  if (board === null) return <PanelLoading />;

  const now = new Date(apiNow());
  const me = signedIn.state === "loaded" ? signedIn.value.signed_in_as : null;
  const rows = rowsOf(board, closed, owners);
  const found = narrowed(rows, filter, me, now);
  const listed = all ? found.rows : found.rows.slice(0, SHOWN_FIRST);
  const openRow = rows.find((row) => keyOf(row) === opened);
  const closeRow = (row: Row) => {
    setClosed((was) => [...was, keyOf(row)]);
    // The row is gone, so the keyboard goes to the list rather than to the top of the page.
    heading.current?.focus();
  };

  const actingOn = (row: Row): Acting => ({
    me,
    staff: board.staff,
    mayOwn: access.reaches(taskNeed(row.group, "act")),
    closable:
      (board.groups.find((group) => group.group === row.group)?.closable ?? false) &&
      access.mayCall("POST /api/tasks/{group}/{id}/close"),
    owner: row.owner,
    onOwner: (owner) => {
      setOwners((was) => new Map(was).set(keyOf(row), owner));
    },
    onClosed: () => {
      closeRow(row);
    },
  });

  const shown = {
    rows: listed,
    now,
    onOpen: (row: Row) => {
      setOpened(keyOf(row));
    },
    onBooked: closeRow,
    actingOn,
  };
  return (
    <>
      <TaskFilters filter={filter} counts={found.counts} onFilter={onFilter} />
      <BoardNotes truncated={board.truncated} lapsed={board.lapsed} shown={lapsed.shown} onToggle={lapsed.toggle} />
      <Panel titleId="tasks" title={tasks.title} headingRef={heading}>
        {found.rows.length === 0 && <EmptyState look="panel" line={tasks.empty} />}
        {found.rows.length > 0 && (phone ? <TaskList {...shown} /> : <TaskTable {...shown} />)}
        <MoreRows found={found.rows.length} all={all} onToggle={setAll} />
      </Panel>
      {openRow !== undefined && (
        <TaskDrawer
          group={openRow.group}
          task={openRow.task}
          subject={subjectOf(openRow.group, openRow.task)}
          now={now}
          acting={actingOn(openRow)}
          onDismiss={() => {
            setOpened(null);
          }}
        />
      )}
    </>
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
    <div className={styles.board}>
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
      <div className={styles.board} hidden={view === "alerts" && alerts > 0}>
        <TaskQueue alerts={alerts} onOpen={setOpen} filter={filter} onFilter={setFilter} />
      </div>
    </div>
  );
}
