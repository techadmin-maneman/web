// A task's drawer, opened from its card on Tasks (./TasksScreen.tsx): what it is, whose it is and when it is due, the
// way to where it is decided, and all else done on it here: the payment link, UPI, the call about a move, and taking,
// giving or closing it.

import { Drawer } from "@maneman/ui/Drawer";
import { TextButton } from "@maneman/ui/TextLink";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { useId, useState } from "react";
import { createPortal } from "react-dom";
import type { Task, TaskGroup } from "../api.ts";
import { OpsLink } from "../components/Shell.tsx";
import { CLOSE, tasks } from "../content.ts";
import { useMayCall } from "../lib/access.ts";
import { Left } from "../lib/Left.tsx";
import { mayFollow } from "../route.ts";
import { decidedAt } from "../lib/task-links.ts";
import { nameParts } from "../lib/who.ts";
import { CallAboutMove } from "./CallAboutMove.tsx";
import { PaymentLinkActions } from "./PaymentLinkActions.tsx";
import { subOf } from "./task-subs.ts";
import { TaskActions } from "./TaskActions.tsx";
import { UpiPaymentAction } from "./UpiPaymentAction.tsx";
import shared from "./tasks.module.css";

type Group = TaskGroup["group"];

/** "priya.sharma@maneman.in" reads "Priya", as the board names an owner in ops by their first name. */
export function ownerName(email: string): string {
  const [first = email] = nameParts(email);
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/**
 * What the task's actions need beyond the task: who is signed in, who a task may be given to, what their access lets
 * them do with it, and what changed.
 */
export interface Acting {
  readonly me: string | null;
  readonly staff: readonly string[];
  /** Whether they may take it, give it or hand it back: Act in the department that decides its group. */
  readonly mayOwn: boolean;
  /** Whether they may close it without a follow-up: a group that allows it, and access that reaches it. */
  readonly closable: boolean;
  readonly owner: string | null;
  readonly onOwner: (owner: string | null) => void;
  readonly onClosed: () => void;
}

/** The way to where the task is decided, a card's one action, which the drawer repeats. */
export function DecideLink({ group, task, subject }: { group: Group; task: Task; subject: string }) {
  const mayCall = useMayCall();
  const where = decidedAt(group, task);
  const action = tasks.decide[group];
  // Where the person may not open the section it is decided in, there is no way to it to offer.
  if (where === null || action === undefined || !mayFollow(mayCall, where)) return null;
  return (
    <OpsLink className={shared.decide} to={where}>
      {action}
      {/* Every card of a group links the same words, so each says whose it is to a screen reader. */}
      <VisuallyHidden>{` · ${subject}`}</VisuallyHidden>
    </OpsLink>
  );
}

interface Props {
  readonly group: Group;
  readonly task: Task;
  readonly subject: string;
  readonly now: Date;
  readonly acting: Acting;
}

function Body({ group, task, subject, acting }: Omit<Props, "now">) {
  return (
    <div className={shared.detail}>
      <span className={shared.sub}>
        {tasks.owner.label}
        {acting.owner === null ? tasks.owner.nobody : ownerName(acting.owner)}
      </span>
      <DecideLink group={group} task={task} subject={subject} />
      {group === "payment_owed" && <PaymentLinkActions task={task} subject={subject} />}
      {(group === "upi_due" || group === "payment_owed") && (
        <UpiPaymentAction task={task} subject={subject} onRecorded={acting.onClosed} />
      )}
      <CallAboutMove group={group} task={task} subject={subject} onTold={acting.onClosed} />
      <TaskActions group={group} task={task} subject={subject} {...acting} />
    </div>
  );
}

/** The card's Details, and its drawer while open. */
export function TaskDetail({ group, task, subject, now, acting }: Props) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const close = () => {
    setOpen(false);
  };
  // A task done here leaves the list: the drawer shuts first, so the list behind it can take the keyboard.
  const done = () => {
    setOpen(false);
    requestAnimationFrame(acting.onClosed);
  };
  return (
    <>
      <TextButton
        tone="muted"
        compact
        aria-expanded={open}
        onClick={() => {
          setOpen(true);
        }}
      >
        {tasks.details}
        <VisuallyHidden>{` · ${subject}`}</VisuallyHidden>
      </TextButton>
      {open &&
        createPortal(
          <Drawer
            titleId={titleId}
            title={subject}
            sub={subOf(task, now)}
            aside={<Left due={task.due} now={now} />}
            close={CLOSE}
            onDismiss={close}
          >
            <Body group={group} task={task} subject={subject} acting={{ ...acting, onClosed: done }} />
          </Drawer>,
          document.body,
        )}
    </>
  );
}
