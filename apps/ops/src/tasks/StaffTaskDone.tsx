// A task written by hand's one step (docs/decisions/0302-tasks-written-by-hand.md): marked done, it leaves the board.

import { RowButton } from "@maneman/ui/Button";
import { Refusal } from "@maneman/ui/Refusal";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { errorText } from "@maneman/web-kit/refusal";
import { useState } from "react";
import type { Task } from "../api.ts";
import { tasks } from "../content.ts";
import { tasksApi } from "./tasks-api.ts";

const copy = tasks.write;

/** Whether a group is a department's tasks written by hand. */
export const isWrittenTask = (group: string): boolean => group.startsWith("staff_task_");

export function StaffTaskDone({ task, onDone }: { readonly task: Task; readonly onDone: () => void }) {
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, once] = useOneAtATime();
  const mark = () =>
    once(async () => {
      setFailed(null);
      const answer = await tasksApi.markTaskDone(task.id);
      if (answer.ok) onDone();
      else setFailed(answer.code);
    });
  return (
    <>
      <RowButton busy={busy} aria-label={copy.doneLabel(task.detail ?? copy.done)} onClick={() => void mark()}>
        {copy.done}
      </RowButton>
      {failed !== null && <Refusal inline said={errorText(copy.errors, { code: failed })} />}
    </>
  );
}
