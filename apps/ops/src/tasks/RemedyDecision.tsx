// A remedy past Care's limit, decided from its task's drawer (./TaskDetail.tsx) by one who may approve it, as a
// technician's leave is (./LeaveDecision.tsx): Approve grants the free visits, Decline grants nothing; either way the
// task leaves the board. Settings' Remedies lists it too, but a decision is never kept only there.

import { Button } from "@maneman/ui/Button";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { errorText } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { api, type Task, type TaskGroup } from "../api.ts";
import { Refusal } from "@maneman/ui/Refusal";
import { tasks } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import shared from "./tasks.module.css";

const copy = tasks.remedy;

export function RemedyDecision(props: { group: TaskGroup["group"]; task: Task; onDecided: () => void }) {
  const mayDecide = useAccess().mayCall("POST /api/remedies/{id}/approve");
  const [busy, once] = useOneAtATime();
  const [refused, setRefused] = useState<string | null>(null);
  if (props.group !== "remedy_approval" || !mayDecide) return null;
  const decide = (approve: boolean) =>
    once(async () => {
      setRefused(null);
      const answer = await api.decideRemedy(props.task.id, approve);
      if (answer.ok) props.onDecided();
      else setRefused(errorText(copy.errors, answer));
    });
  return (
    <div className={shared.cardActions}>
      <Button variant="primary" size="small" disabled={busy} onClick={() => void decide(true)}>
        {busy ? copy.sending : copy.approve}
      </Button>
      <Button variant="outline" size="small" disabled={busy} onClick={() => void decide(false)}>
        {copy.decline}
      </Button>
      {refused !== null && <Refusal said={refused} />}
    </div>
  );
}
