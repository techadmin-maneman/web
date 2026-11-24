// The way to where a task is decided (./TaskDetail.tsx's drawer and a row's one step, ./RowStep.tsx): a file of its
// own, so a row on Today links there without loading the drawer.

import { ACTION_ICONS } from "@maneman/brand/action-icons";
import { buttonLook } from "@maneman/ui/Button";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import type { Task, TaskGroup } from "../api.ts";
import { tasks } from "../content.ts";
import { OpsLink } from "../frame/Shell.tsx";
import { useMayCall } from "../lib/access.ts";
import { decidedAt } from "../lib/task-links.ts";
import { mayFollow } from "../route.ts";

type Group = TaskGroup["group"];

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
    <OpsLink
      className={buttonLook({ variant: primary ? "primary" : "outline", size: "compact", iconOnly: true })}
      icon={ACTION_ICONS.arrowUpRight}
      to={where}
    >
      {action}
      {/* Every row of a group links the same words, so each says whose it is to a screen reader. */}
      <VisuallyHidden>{` · ${subject}`}</VisuallyHidden>
    </OpsLink>
  );
}
