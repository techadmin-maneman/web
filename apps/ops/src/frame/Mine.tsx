// What is yours on Tasks, in the frame's header: how many tasks were given to you that you have not yet seen, and the
// list of all yours, each a way to where it is done. It reads the board the navigation reads (../lib/waiting.ts), again
// each minute a page is open, so a task given to you shows within the minute. What you have seen is kept in this
// browser alone.

import { Popover, PopoverItem, PopoverNote } from "@maneman/ui/Popover";
import { go } from "@maneman/ui/router";
import { useLoad } from "@maneman/ui/useLoad";
import { useEffect, useRef, useState } from "react";
import type { Task, TaskGroup } from "../api.ts";
import { shell, tasks } from "../content.ts";
import { useMayCall, whoami } from "../lib/access.ts";
import { subjectOf, taskClientPath } from "../lib/task-links.ts";
import { useTaskBoard } from "../lib/waiting.ts";
import { mayOpen } from "../route.ts";
import styles from "./mine.module.css";

const SEEN = "ops.mine-seen";

interface Yours {
  readonly group: TaskGroup["group"];
  readonly task: Task;
}

const keyOf = ({ group, task }: Yours) => `${group}/${task.id}`;

function seenBefore(): ReadonlySet<string> {
  try {
    const kept: unknown = JSON.parse(localStorage.getItem(SEEN) ?? "[]");
    return new Set(Array.isArray(kept) ? kept.filter((each): each is string => typeof each === "string") : []);
  } catch {
    return new Set();
  }
}

function keepSeen(keys: readonly string[]): void {
  try {
    localStorage.setItem(SEEN, JSON.stringify(keys));
  } catch {
    // A browser that keeps nothing shows every task as new again next time; nothing is lost.
  }
}

/** The list, which marks every task in it seen once it is open. */
function YoursList({ yours, onSeen, close }: { yours: readonly Yours[]; onSeen: () => void; close: () => void }) {
  const marked = useRef(false);
  useEffect(() => {
    if (marked.current) return;
    marked.current = true;
    keepSeen(yours.map(keyOf));
    onSeen();
  });
  if (yours.length === 0) return <PopoverNote>{shell.mine.none}</PopoverNote>;
  return (
    <>
      {yours.map((each) => (
        <PopoverItem
          key={keyOf(each)}
          onClick={() => {
            close();
            go(each.task.person === null ? "/tasks" : taskClientPath(each.group, each.task.person.id));
          }}
        >
          {shell.mine.item(tasks.groups[each.group], subjectOf(each.group, each.task))}
        </PopoverItem>
      ))}
    </>
  );
}

export function Mine() {
  const [who] = useLoad(whoami);
  const mayCall = useMayCall();
  const board = useTaskBoard(mayCall !== null && mayOpen(mayCall, "tasks"));
  const [seen, setSeen] = useState(seenBefore);
  if (who.state !== "loaded" || board === null) return null;
  const me = who.value.signed_in_as;
  const yours = board.groups.flatMap((group) =>
    group.tasks.filter((task) => task.owner === me).map((task) => ({ group: group.group, task })),
  );
  const unseen = yours.filter((each) => !seen.has(keyOf(each))).length;
  return (
    <Popover
      label={shell.mine.label(unseen)}
      align="end"
      button={
        <>
          {shell.mine.button}
          {unseen > 0 && <span className={styles.count}>{unseen}</span>}
        </>
      }
    >
      {(close) => (
        <YoursList
          yours={yours}
          close={close}
          onSeen={() => {
            setSeen(seenBefore());
          }}
        />
      )}
    </Popover>
  );
}
