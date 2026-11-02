// What waits on Tasks for this client, under the head of their page: a row each, ruled in the tone of how late it is,
// with how long it has left, Take it, and the task's own step. Nothing open, nothing is drawn.

import { ListRow, ListRows } from "@maneman/ui/ListRow";
import { PanelFailed } from "@maneman/ui/States";
import { useLoad } from "@maneman/ui/useLoad";
import { apiNow } from "@maneman/web-kit/clock";
import { useCallback, useState } from "react";
import { type Task, type TaskGroup, type Tasks } from "../api.ts";
import { clients, tasks as taskCopy } from "../content.ts";
import { taskNeed, useAccess, useMayCall, whoami } from "../lib/access.ts";
import { dueRule } from "../lib/due.ts";
import { Left } from "../lib/Left.tsx";
import { decidedAt } from "../lib/task-links.ts";
import { mayFollow } from "../route.ts";
import { BookFromTask, DecideLink, TakeButton, subOf, type Acting } from "../tasks/index.ts";
import styles from "./clients.module.css";
import { clientsApi } from "./clients-api.ts";

type Group = TaskGroup["group"];

interface Open {
  readonly group: Group;
  readonly task: Task;
}

const keyOf = (open: Open): string => `${open.group}/${open.task.id}`;

/** Take it, where nobody has, then the way to where it is decided, or the booking it waits for. */
function Steps({ open, name, acting }: { open: Open; name: string; acting: Acting }) {
  const { group, task } = open;
  return (
    <span className={styles.taskSteps}>
      <TakeButton group={group} task={task} subject={name} {...acting} />
      <DecideLink group={group} task={task} subject={name} primary />
      <BookFromTask task={task} subject={name} primary onBooked={acting.onClosed} />
    </span>
  );
}

function List({ board, name }: { board: Tasks; name: string }) {
  const now = new Date(apiNow());
  const access = useAccess();
  const mayCall = useMayCall();
  const [signedIn] = useLoad(whoami);
  const me = signedIn.state === "loaded" ? signedIn.value.signed_in_as : null;
  const [owners, setOwners] = useState<ReadonlyMap<string, string | null>>(new Map());
  const [closed, setClosed] = useState<readonly string[]>([]);
  const open = board.groups
    .flatMap((group) => group.tasks.map((task) => ({ group: group.group, task })))
    .filter((each) => !closed.includes(keyOf(each)));
  if (open.length === 0) return null;
  // A phone leaves a row's actions out: the row itself goes to where the task is decided.
  const placeOf = (each: Open): string | undefined => {
    const where = decidedAt(each.group, each.task);
    return where !== null && mayFollow(mayCall, where) ? where : undefined;
  };
  const actingOn = (each: Open): Acting => ({
    me,
    staff: board.staff,
    mayOwn: access.reaches(taskNeed(each.group, "act")),
    closable: false,
    owner: owners.has(keyOf(each)) ? (owners.get(keyOf(each)) ?? null) : each.task.owner,
    onOwner: (owner) => {
      setOwners((was) => new Map(was).set(keyOf(each), owner));
    },
    onClosed: () => {
      setClosed((was) => [...was, keyOf(each)]);
    },
  });
  return (
    <ListRows label={clients.openTasks.title}>
      {open.map((each) => (
        <ListRow
          key={keyOf(each)}
          title={taskCopy.groups[each.group]}
          meta={subOf(each.task, now)}
          end={<Left due={each.task.due} now={now} />}
          endTone="plain"
          rule={dueRule(each.task.due, now) ?? "attention"}
          to={placeOf(each)}
          action={<Steps open={each} name={name} acting={actingOn(each)} />}
        />
      ))}
    </ListRows>
  );
}

function Read({ clientId, name }: { clientId: string; name: string }) {
  const load = useCallback(() => clientsApi.clientTasks(clientId), [clientId]);
  const [loaded, retry] = useLoad(load);
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  return loaded.state === "loaded" ? <List board={loaded.value} name={name} /> : null;
}

export function OpenTasks({ clientId, name }: { clientId: string; name: string }) {
  const mayRead = useAccess().mayCall("GET /api/tasks");
  return mayRead ? <Read clientId={clientId} name={name} /> : null;
}
