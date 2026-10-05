// What waits on Tasks for this client, under the head of their page: each task's group, how long it has left, and a
// way to where it is done. No board draws it.

import { capsLook } from "@maneman/ui/Caps";
import { useLoad, whenLoaded } from "@maneman/ui/useLoad";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { useCallback } from "react";
import { api, type Task, type TaskGroup, type Tasks } from "../api.ts";
import { OpsLink } from "../components/Shell.tsx";
import { clients, tasks as taskCopy } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { Left } from "../lib/Left.tsx";
import { decidedAt, taskClientPath, taskTabOf } from "../lib/task-links.ts";
import styles from "./clients.module.css";

const copy = clients.openTasks;

type Group = TaskGroup["group"];

const tabLabel = (group: Group): string =>
  clients.tabs.find((each) => each.tab === taskTabOf(group))?.label ?? clients.title;

/** Where the task is done, in words: its own section where it is decided there, otherwise a tab of this page. */
function wayTo(group: Group, task: Task, clientId: string): { readonly to: string; readonly words: string } {
  const decided = decidedAt(group, task);
  const action = taskCopy.decide[group];
  if (decided !== null && action !== undefined) return { to: decided, words: action };
  return { to: taskClientPath(group, clientId), words: copy.toTab(tabLabel(group)) };
}

function Row({ group, task, clientId, now }: { group: Group; task: Task; clientId: string; now: Date }) {
  const name = taskCopy.groups[group];
  const way = wayTo(group, task, clientId);
  return (
    <li className={styles.openTask}>
      <span className={styles.openTaskName}>{name}</span>
      <Left due={task.due} now={now} />
      <OpsLink className={styles.metaLink} to={way.to}>
        {way.words}
        <VisuallyHidden>{` · ${name}`}</VisuallyHidden>
      </OpsLink>
    </li>
  );
}

function List({ board, clientId }: { board: Tasks; clientId: string }) {
  const now = new Date();
  const rows = board.groups.flatMap((group) => group.tasks.map((task) => ({ group: group.group, task })));
  if (rows.length === 0) return <p className={styles.openNone}>{copy.none}</p>;
  return (
    <ul className={styles.openTasks}>
      {rows.map(({ group, task }) => (
        <Row key={`${group}/${task.id}`} group={group} task={task} clientId={clientId} now={now} />
      ))}
    </ul>
  );
}

function Strip({ clientId }: { clientId: string }) {
  const load = useCallback(() => api.clientTasks(clientId), [clientId]);
  const [loaded] = useLoad(load);
  return (
    <section className={styles.open} aria-labelledby="open-tasks">
      <h3 className={capsLook(styles.sectionTitle)} id="open-tasks">
        {copy.title}
      </h3>
      {whenLoaded(loaded, {
        loading: null,
        failed: <p className={styles.openNone}>{copy.failed}</p>,
        loaded: (board) => <List board={board} clientId={clientId} />,
      })}
    </section>
  );
}

export function OpenTasks({ clientId }: { clientId: string }) {
  const mayRead = useAccess().mayCall("GET /api/tasks");
  return mayRead ? <Strip clientId={clientId} /> : null;
}
