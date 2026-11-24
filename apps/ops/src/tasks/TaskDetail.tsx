// A task's drawer, opened from its row on Tasks (./TasksScreen.tsx): what it is, whom it is about and whose it is; all
// else done on it here, the payment link, UPI, the call about a move, leave and a claim's photographs; and at its foot,
// taking it, giving it to someone or closing it, beside the step that settles it.

import { DescriptionList } from "@maneman/ui/DescriptionList";
import { Drawer } from "@maneman/ui/Drawer";
import { NoValue } from "@maneman/ui/NoValue";
import { Suspense, useId } from "react";
import { createPortal } from "react-dom";
import type { Task, TaskGroup } from "../api.ts";
import { OpsLink } from "../frame/Shell.tsx";
import { CLOSE, tasks } from "../content.ts";
import { Left } from "../lib/Left.tsx";
import { taskClientPath } from "../lib/task-links.ts";
import { nameParts } from "../lib/who.ts";
import { lazyScreen } from "@maneman/ui/lazyScreen";
import { BookFromTask } from "./BookFromTask.tsx";
import { DecideLink } from "./DecideLink.tsx";
import { CallAboutMove } from "./CallAboutMove.tsx";
import { LeaveDecision } from "./LeaveDecision.tsx";
import { RemedyDecision } from "./RemedyDecision.tsx";
import { PaymentLinkActions } from "./PaymentLinkActions.tsx";
import { subOf } from "./task-subs.ts";
import { TaskActions } from "./TaskActions.tsx";
import { UpiPaymentAction } from "./UpiPaymentAction.tsx";
import { SnoozeButton } from "./Snooze.tsx";
import { isWrittenTask } from "@rules/policy/tasks.ts";
import { StaffTaskDone } from "./StaffTaskDone.tsx";
import shared from "./tasks.module.css";

/** A claim's photographs, loaded when a claim is first opened, so Today's first load leaves Care's section out. */
const ReportPhotos = lazyScreen(() => import("../care/index.ts").then((module) => module.ReportPhotos));

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
  /** Whether its group may be snoozed: all but the requests about a client's own data. */
  readonly snoozable: boolean;
  readonly owner: string | null;
  readonly onOwner: (owner: string | null) => void;
  readonly onClosed: () => void;
  /** It was snoozed until the moment given: it leaves the list, and the page says until when. */
  readonly onSnoozed?: (until: string) => void;
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
            <SnoozeButton
              group={group}
              task={task}
              mayAct={acting.mayOwn && acting.snoozable}
              onSnoozed={(until) => {
                onDismiss();
                requestAnimationFrame(() => {
                  if (acting.onSnoozed === undefined) acting.onClosed();
                  else acting.onSnoozed(until);
                });
              }}
            />
            {isWrittenTask(group) && acting.mayOwn && <StaffTaskDone task={task} onDone={done} primary />}
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
        <RemedyDecision group={group} task={task} onDecided={done} />
        {task.facts.group === "fit_guarantee_claim" && task.facts.conversation_id !== null && (
          <Suspense fallback={null}>
            <ReportPhotos conversationId={task.facts.conversation_id} only={task.facts.references} />
          </Suspense>
        )}
      </div>
    </Drawer>,
    document.body,
  );
}
