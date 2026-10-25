// A technician's ask for leave, decided from its task's drawer (./TaskDetail.tsx): Approve records the leave as ops
// record it on the technician's page, Decline only the decision; either way the task leaves the board.

import { Button } from "@maneman/ui/Button";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { errorText } from "@maneman/web-kit/refusal";
import { useState } from "react";
import type { Task, TaskGroup } from "../api.ts";
import { Refusal } from "../components/Refusal.tsx";
import { tasks } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import shared from "./tasks.module.css";
import { tasksApi } from "./tasks-api.ts";

const copy = tasks.leave;

export function LeaveDecision(props: { group: TaskGroup["group"]; task: Task; onDecided: () => void }) {
  const mayDecide = useAccess().mayCall("POST /api/leave-requests/{id}/decision");
  const [busy, once] = useOneAtATime();
  const [refused, setRefused] = useState<string | null>(null);
  if (props.group !== "leave_request" || !mayDecide) return null;
  const decide = (decision: "approved" | "declined") =>
    once(async () => {
      setRefused(null);
      const answer = await tasksApi.decideLeave(props.task.id, decision);
      if (answer.ok) props.onDecided();
      else setRefused(errorText(copy.errors, answer));
    });
  return (
    <div className={shared.cardActions}>
      <Button variant="primary" size="small" disabled={busy} onClick={() => void decide("approved")}>
        {busy ? copy.sending : copy.approve}
      </Button>
      <Button variant="outline" size="small" disabled={busy} onClick={() => void decide("declined")}>
        {copy.decline}
      </Button>
      {refused !== null && <Refusal said={refused} />}
    </div>
  );
}
