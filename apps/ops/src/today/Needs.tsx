// Needs you, on each of Today's homes (ADR 0227): the tasks on the person's board, their own first, then the longest
// overdue. Each row carries the rule of how late it is, what it is, whom it is about, when it is due and, on a
// desk, its one step, as Tasks' row ends with it; a phone's row opens where it is decided. A link to Tasks closes the
// panel.

import { capsLook } from "@maneman/ui/Caps";
import { EmptyState } from "@maneman/ui/EmptyState";
import { ListRow, ListRows } from "@maneman/ui/ListRow";
import { Panel } from "@maneman/ui/Panel";
import { useLoad } from "@maneman/ui/useLoad";
import { apiNow } from "@maneman/web-kit/clock";
import { useState } from "react";
import type { Task, TaskGroup, Tasks } from "../api.ts";
import { tasks as taskWords } from "../content.ts";
import { today as copy } from "../content/today.ts";
import { OpsLink } from "../frame/Shell.tsx";
import { taskNeed, useAccess, useMayCall, whoami } from "../lib/access.ts";
import { dueRule } from "../lib/due.ts";
import { Left } from "../lib/Left.tsx";
import { useIsPhone } from "../lib/media.ts";
import { decidedAt, subjectOf, taskClientPath } from "../lib/task-links.ts";
import { mayFollow, NAV_NAMES, sectionOf } from "../route.ts";
import { RowStep, subOf, type Acting, type Row } from "../tasks/index.ts";
import styles from "./today.module.css";

type Group = TaskGroup["group"];

interface Waiting {
  readonly group: Group;
  readonly task: Task;
}

/** A task by its group and its row's id, as the API names it. */
const keyOf = (waiting: Waiting): string => `${waiting.group}/${waiting.task.id}`;

/** As many as one look takes in. */
const NEEDS_SHOWN = 10;

function needsOf(board: Tasks, me: string | null): Waiting[] {
  const mine = (waiting: Waiting) => (me !== null && waiting.task.owner === me ? 0 : 1);
  return board.groups
    .flatMap((group) => group.tasks.map((task) => ({ group: group.group, task })))
    .sort((one, other) => mine(one) - mine(other) || Date.parse(one.task.due) - Date.parse(other.task.due))
    .slice(0, NEEDS_SHOWN);
}

function NeedRow({ row, now, acting }: { readonly row: Row; readonly now: Date; readonly acting: Acting }) {
  const mayCall = useMayCall();
  const phone = useIsPhone();
  const { group, task } = row;
  const subject = subjectOf(group, task);
  const where = decidedAt(group, task);
  const decide = taskWords.decide[group] !== undefined && where !== null && mayFollow(mayCall, where) ? where : null;
  const client = task.person === null ? null : taskClientPath(group, task.person.id);
  const opens = phone ? (decide ?? client) : client;
  const sub = subOf(task, now);
  return (
    <ListRow
      title={taskWords.groups[group]}
      meta={sub === "" ? subject : `${subject} · ${sub}`}
      end={<Left due={task.due} now={now} />}
      endTone="plain"
      rule={dueRule(task.due, now)}
      to={opens !== null && mayFollow(mayCall, opens) ? opens : undefined}
      action={phone ? undefined : <RowStep row={row} subject={subject} acting={acting} onBooked={acting.onClosed} />}
    />
  );
}

/** The rows taken or done from Today since the board was read, so the list follows them. */
function useSettled() {
  const [owners, setOwners] = useState<ReadonlyMap<string, string | null>>(new Map());
  const [closed, setClosed] = useState<readonly string[]>([]);
  return {
    ownerOf: (key: string, owner: string | null) => (owners.has(key) ? (owners.get(key) ?? null) : owner),
    isClosed: (key: string) => closed.includes(key),
    setOwner: (key: string, owner: string | null) => {
      setOwners((was) => new Map(was).set(key, owner));
    },
    close: (key: string) => {
      setClosed((was) => [...was, key]);
    },
  };
}

export function Needs({ board }: { readonly board: Tasks }) {
  const now = new Date(apiNow());
  const phone = useIsPhone();
  const [signedIn] = useLoad(whoami);
  const access = useAccess();
  const settled = useSettled();
  const me = signedIn.state === "loaded" ? signedIn.value.signed_in_as : null;
  const needs = needsOf(board, me).filter((waiting) => !settled.isClosed(keyOf(waiting)));
  const actingOn = (row: Row): Acting => ({
    me,
    staff: board.staff,
    mayOwn: access.reaches(taskNeed(row.group, "act")),
    closable: false,
    owner: row.owner,
    onOwner: (owner) => {
      settled.setOwner(keyOf(row), owner);
    },
    onClosed: () => {
      settled.close(keyOf(row));
    },
  });
  const count = board.groups.reduce((sum, group) => sum + group.count, 0);
  const listed =
    needs.length === 0 ? (
      <EmptyState look="panel" line={copy.none} />
    ) : (
      <ListRows inPanel={!phone}>
        {needs.map((waiting) => {
          const row = { ...waiting, owner: settled.ownerOf(keyOf(waiting), waiting.task.owner) };
          return <NeedRow key={keyOf(waiting)} row={row} now={now} acting={actingOn(row)} />;
        })}
      </ListRows>
    );
  // A phone heads the list in small capitals, as a section of the page; Tasks is a tab of its own there.
  if (phone)
    return (
      <section className={styles.section} aria-labelledby="needs">
        <h2 id="needs" className={capsLook(styles.label)}>
          {copy.needs}
        </h2>
        {listed}
      </section>
    );
  return (
    <Panel titleId="needs" title={copy.needs} count={count}>
      {listed}
      <p className={styles.foot}>
        <OpsLink to={sectionOf("tasks").path}>{NAV_NAMES.tasks}</OpsLink>
      </p>
    </Panel>
  );
}
