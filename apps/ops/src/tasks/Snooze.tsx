// A task snoozed from its panel until 10 am tomorrow (docs/decisions/0303-snoozing-a-task.md): it leaves the board until
// then, and the page says so.

import { Button } from "@maneman/ui/Button";
import { Refusal } from "@maneman/ui/Refusal";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { errorText } from "@maneman/web-kit/refusal";
import { useState } from "react";
import type { Task, TaskGroup } from "../api.ts";
import { tasks } from "../content.ts";
import { tasksApi } from "./tasks-api.ts";

const copy = tasks.snooze;

export function SnoozeButton(props: {
  readonly group: TaskGroup["group"];
  readonly task: Task;
  /** Whether their access reaches it: Act in the department that decides its group. */
  readonly mayAct: boolean;
  /** Snoozed, until when. */
  readonly onSnoozed: (until: string) => void;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, once] = useOneAtATime();
  if (!props.mayAct) return null;
  const snooze = () =>
    once(async () => {
      setFailed(null);
      const answer = await tasksApi.snoozeTask(props.group, props.task.id);
      if (answer.ok) props.onSnoozed(answer.body.until);
      else setFailed(answer.code);
    });
  return (
    <>
      <Button variant="outline" size="small" busy={busy} onClick={() => void snooze()}>
        {copy.button}
      </Button>
      {failed !== null && <Refusal inline said={errorText(copy.errors, { code: failed })} />}
    </>
  );
}
