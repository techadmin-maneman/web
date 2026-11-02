// A task's one action on a row, on Tasks and on Today's Needs you: the way to where it is decided, the booking that does
// it, or else taking it while nobody has it. What else is done on a task is in its drawer (./TaskDetail.tsx).

import { tasks } from "../content.ts";
import { useAccess, useMayCall } from "../lib/access.ts";
import { decidedAt } from "../lib/task-links.ts";
import { mayFollow } from "../route.ts";
import { BookFromTask, booksFrom } from "./BookFromTask.tsx";
import { TakeButton } from "./TaskActions.tsx";
import { DecideLink, type Acting } from "./TaskDetail.tsx";
import type { Row } from "./task-views.ts";

/** The row's one action: the way to where it is decided, the booking that does it, or else taking it. */
export function RowStep({
  row,
  subject,
  acting,
  onBooked,
}: {
  row: Row;
  subject: string;
  acting: Acting;
  onBooked: (row: Row) => void;
}) {
  const mayCall = useMayCall();
  const mayBook = useAccess().mayCall("POST /api/visits");
  const { group, task } = row;
  const where = decidedAt(group, task);
  if (where !== null && tasks.decide[group] !== undefined && mayFollow(mayCall, where))
    return <DecideLink group={group} task={task} subject={subject} />;
  if (mayBook && booksFrom(task))
    return (
      <BookFromTask
        task={task}
        subject={subject}
        onBooked={() => {
          onBooked(row);
        }}
      />
    );
  return <TakeButton group={group} task={task} subject={subject} {...acting} />;
}
