// A task written by hand's one step (docs/decisions/0302-tasks-written-by-hand.md): marked done, it leaves the board.

import { Button, RowButton } from "@maneman/ui/Button";
import { Refusal } from "@maneman/ui/Refusal";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { errorText } from "@maneman/web-kit/refusal";
import { useState } from "react";
import type { Task } from "../api.ts";
import { tasks } from "../content.ts";
import { tasksApi } from "./tasks-api.ts";

const copy = tasks.write;

export function StaffTaskDone({
  task,
  onDone,
  primary = false,
}: {
  readonly task: Task;
  readonly onDone: () => void;
  /** The panel's step, a filled button, rather than the row's. */
  readonly primary?: boolean;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, once] = useOneAtATime();
  const mark = () =>
    once(async () => {
      setFailed(null);
      const answer = await tasksApi.markTaskDone(task.id);
      if (answer.ok) onDone();
      else setFailed(answer.code);
    });
  const label = copy.doneLabel(task.detail ?? copy.done);
  return (
    <>
      {primary ? (
        <Button variant="primary" size="small" busy={busy} aria-label={label} onClick={() => void mark()}>
          {copy.done}
        </Button>
      ) : (
        <RowButton busy={busy} aria-label={label} onClick={() => void mark()}>
          {copy.done}
        </RowButton>
      )}
      {failed !== null && <Refusal inline said={errorText(copy.errors, { code: failed })} />}
    </>
  );
}
