// The Tasks board's table at a desk (./TasksScreen.tsx): a task a row, the longest overdue first, each with its box to
// choose it with others (./BulkActions.tsx), and the keys a desk moves by: j or ↓ to the next row, k or ↑ to the one
// before, x to choose it, and Enter on its name to open it.

import { classes } from "@maneman/ui/classes";
import { Checkbox } from "@maneman/ui/Field";
import { NoValue } from "@maneman/ui/NoValue";
import { RowOpener, rowRule, Table } from "@maneman/ui/Table";
import type { RowSelection } from "@maneman/ui/useRowSelection";
import { tables } from "@maneman/ui/words";
import { useEffect, useRef } from "react";
import { tasks } from "../content.ts";
import { OpsLink } from "../frame/Shell.tsx";
import { dueRule } from "../lib/due.ts";
import { Left } from "../lib/Left.tsx";
import { subjectOf, taskClientPath } from "../lib/task-links.ts";
import { RowStep } from "./RowStep.tsx";
import { ownerName, type Acting } from "./TaskDetail.tsx";
import { subOf } from "./task-subs.ts";
import type { Row } from "./task-views.ts";
import styles from "./tasks-screen.module.css";

/** A task by its group and its row's id, as the API names it. */
export const keyOf = (row: Pick<Row, "group" | "task">) => `${row.group}/${row.task.id}`;

export interface Listed {
  readonly rows: readonly Row[];
  readonly now: Date;
  readonly onOpen: (row: Row) => void;
  readonly onBooked: (row: Row) => void;
  readonly actingOn: (row: Row) => Acting;
  /** The rows chosen, where the person may change any; null draws no boxes. */
  readonly selection?: RowSelection | null;
}

/** Where each key moves: a row on, or a row back. */
const MOVES: Readonly<Record<string, number>> = { j: 1, ArrowDown: 1, k: -1, ArrowUp: -1 };

/** The keys on the table's rows: moving between their names, and x to choose the row. */
function useRowKeys(selection: RowSelection | null) {
  const body = useRef<HTMLTableSectionElement>(null);
  useEffect(() => {
    const rows = body.current;
    if (rows === null) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || !(event.target instanceof HTMLElement)) return;
      // A box ops type in, or a list they choose from, keeps its keys.
      if (event.target.closest("textarea, select, input:not([type=checkbox])") !== null) return;
      const row = event.target.closest<HTMLTableRowElement>("tr[data-row]");
      if (row === null) return;
      // Shift, or Caps Lock, sends a letter's capital.
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (key === "x" && selection !== null) {
        event.preventDefault();
        selection.toggle(row.dataset.row ?? "", event.shiftKey);
        return;
      }
      const step = MOVES[key];
      if (step === undefined) return;
      const next = step > 0 ? row.nextElementSibling : row.previousElementSibling;
      const name = next?.querySelector<HTMLElement>("th button");
      if (name === null || name === undefined) return;
      event.preventDefault();
      name.focus();
    };
    rows.addEventListener("keydown", onKey);
    return () => {
      rows.removeEventListener("keydown", onKey);
    };
  }, [selection]);
  return body;
}

/** A row's box, read with what and whom; ticked with Shift held, the run from the last one ticked. */
function ChooseCell({ row, subject, selection }: { row: Row; subject: string; selection: RowSelection }) {
  const key = keyOf(row);
  return (
    <td className={styles.choose}>
      <Checkbox
        aria-label={tasks.bulk.choose(tasks.groups[row.group], subject)}
        checked={selection.selected.has(key)}
        onChange={(event) => {
          selection.toggle(key, (event.nativeEvent as { shiftKey?: boolean }).shiftKey === true);
        }}
      />
    </td>
  );
}

export function TaskTable({ rows, now, onOpen, onBooked, actingOn, selection = null }: Listed) {
  const columns = tasks.columns;
  const body = useRowKeys(selection);
  return (
    <Table fixed className={classes(styles.table, selection !== null && styles.chooses)}>
      <thead>
        <tr>
          {selection !== null && (
            <th scope="col" className={styles.choose}>
              <Checkbox aria-label={tables.chooseAll} checked={selection.all} onChange={selection.toggleAll} />
            </th>
          )}
          <th scope="col">{columns.what}</th>
          <th scope="col">{columns.who}</th>
          <th scope="col">{columns.due}</th>
          <th scope="col">{columns.owner}</th>
          <th scope="col" />
        </tr>
      </thead>
      <tbody ref={body}>
        {rows.map((row) => {
          const { group, task } = row;
          const subject = subjectOf(group, task);
          const sub = subOf(task, now);
          return (
            <tr
              key={keyOf(row)}
              data-row={keyOf(row)}
              className={classes(
                rowRule(dueRule(task.due, now)),
                selection?.selected.has(keyOf(row)) === true && styles.chosen,
              )}
            >
              {selection !== null && <ChooseCell row={row} subject={subject} selection={selection} />}
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
