// A move the client has not heard of, settled from its row: the number to call, and "Told by phone" once ops have
// called. The task leaves the board once the call is recorded, as it does from the dispatch board's drawer.

import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { useState } from "react";
import { api, type Task, type TaskGroup } from "../api.ts";
import { tasks } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { phoneWords } from "../lib/phone.ts";
import styles from "./tasks.module.css";

const copy = tasks.call;

export function CallAboutMove({
  group,
  task,
  subject,
  onTold,
}: {
  group: TaskGroup["group"];
  task: Task;
  /** Who the task heads with, which each action names to a screen reader. */
  subject: string;
  /** The call is recorded, or was already: the task is done. */
  onTold: () => void;
}) {
  const mayTell = useAccess().mayCall("POST /api/dispatch/moves/{id}/told");
  const [busy, once] = useOneAtATime();
  const [failed, setFailed] = useState(false);
  const mobile = task.person?.mobile;
  if (group !== "untold_move" || mobile === undefined) return null;

  const record = () =>
    once(async () => {
      setFailed(false);
      const answer = await api.toldByPhone(task.id);
      // Not found: someone recorded the call meanwhile, or a later move told the client. Either way it is done.
      if (answer.ok || answer.code === "not_found") onTold();
      else setFailed(true);
    });

  return (
    <span className={styles.acts}>
      <a className={styles.act} href={`tel:${mobile}`}>
        {copy.call(phoneWords(mobile))}
        <VisuallyHidden>{` · ${subject}`}</VisuallyHidden>
      </a>
      {mayTell && (
        <button type="button" className={styles.act} disabled={busy} onClick={() => void record()}>
          {busy ? copy.recording : copy.told}
          <VisuallyHidden>{` · ${subject}`}</VisuallyHidden>
        </button>
      )}
      {failed && (
        <span className={styles.error} role="alert">
          {copy.failed}
        </span>
      )}
    </span>
  );
}
