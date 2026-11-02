// A task's drawer, opened from its row on Tasks (./TasksScreen.tsx): what it is, whom it is about and whose it is; all
// else done on it here, the payment link, UPI, the call about a move and leave; and at its foot, taking it, giving it to
// someone or closing it, beside the step that settles it.

import { buttonLook } from "@maneman/ui/Button";
import { DescriptionList } from "@maneman/ui/DescriptionList";
import { Drawer } from "@maneman/ui/Drawer";
import { NoValue } from "@maneman/ui/NoValue";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { useId } from "react";
import { createPortal } from "react-dom";
import type { Task, TaskGroup } from "../api.ts";
import { OpsLink } from "../frame/Shell.tsx";
import { CLOSE, tasks } from "../content.ts";
import { useMayCall } from "../lib/access.ts";
import { Left } from "../lib/Left.tsx";
import { mayFollow } from "../route.ts";
import { decidedAt, taskClientPath } from "../lib/task-links.ts";
import { nameParts } from "../lib/who.ts";
import { BookFromTask } from "./BookFromTask.tsx";
import { CallAboutMove } from "./CallAboutMove.tsx";
import { LeaveDecision } from "./LeaveDecision.tsx";
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

/** The way to where the task is decided: a row's one action, outlined, and the drawer's main one, filled. */
export function DecideLink({
  group,
  task,
  subject,
  primary = false,
}: {
  group: Group;
  task: Task;
  subject: string;
  primary?: boolean;
}) {
  const mayCall = useMayCall();
  const where = decidedAt(group, task);
  const action = tasks.decide[group];
  // Where the person may not open the section it is decided in, there is no way to it to offer.
  if (where === null || action === undefined || !mayFollow(mayCall, where)) return null;
  return (
    <OpsLink className={buttonLook({ variant: primary ? "primary" : "outline", size: "compact" })} to={where}>
      {action}
      {/* Every row of a group links the same words, so each says whose it is to a screen reader. */}
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
  readonly onDismiss: () => void;
}

function Facts({
  group,
  task,
  subject,
  owner,
}: Omit<Props, "acting" | "onDismiss" | "now"> & { owner: string | null }) {
  const who = task.person === null ? subject : <OpsLink to={taskClientPath(group, task.person.id)}>{subject}</OpsLink>;
  return (
    <DescriptionList
      className={shared.facts}
      layout="list"
      items={[
        { term: tasks.columns.what, details: tasks.groups[group] },
        { term: tasks.columns.who, details: who },
        { term: tasks.columns.owner, details: owner === null ? <NoValue /> : ownerName(owner) },
      ]}
    />
  );
}

/** The task's drawer while it is open. */
export function TaskDrawer({ group, task, subject, now, acting, onDismiss }: Props) {
  const titleId = useId();
  // A task done here leaves the list: the drawer shuts first, so the list behind it can take the keyboard.
  const done = () => {
    onDismiss();
    requestAnimationFrame(acting.onClosed);
  };
  const settling = { ...acting, onClosed: done };
  return createPortal(
    <Drawer
      titleId={titleId}
      title={subject}
      sub={subOf(task, now)}
      aside={<Left due={task.due} now={now} />}
      close={CLOSE}
      onDismiss={onDismiss}
      foot={
        <div className={shared.foot}>
          <div className={shared.footOwner}>
            <TaskActions group={group} task={task} subject={subject} {...settling} />
          </div>
          <div className={shared.footStep}>
            <DecideLink group={group} task={task} subject={subject} primary />
            <BookFromTask task={task} subject={subject} primary onBooked={done} />
          </div>
        </div>
      }
    >
      <div className={shared.detail}>
        <Facts group={group} task={task} subject={subject} owner={acting.owner} />
        {group === "payment_owed" && <PaymentLinkActions task={task} subject={subject} />}
        {(group === "upi_due" || group === "payment_owed") && (
          <UpiPaymentAction task={task} subject={subject} onRecorded={done} />
        )}
        <CallAboutMove group={group} task={task} subject={subject} onTold={done} />
        <LeaveDecision group={group} task={task} onDecided={done} />
      </div>
    </Drawer>,
    document.body,
  );
}
