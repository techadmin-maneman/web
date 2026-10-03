// A task done by booking the client a visit: a consultation asked for, a first fit to book, and a replacement due
// (src/policy/tasks.ts). The row opens the panel the client's page books from, started from what the task holds; the
// task leaves the board once the visit is booked, and stays while a payment link for it waits to be paid.

import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { useRef, useState } from "react";
import type { BookingWindow, Task, TaskGroup } from "../api.ts";
import { BookVisit, type Prefill } from "../clients/BookVisit.tsx";
import { tasks } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import styles from "./tasks.module.css";

type Group = TaskGroup["group"];

const WINDOWS: readonly string[] = ["morning", "afternoon", "evening"];
const isWindow = (text: string | undefined): text is BookingWindow => text !== undefined && WINDOWS.includes(text);
const isDate = (text: string | undefined): text is string => text !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(text);

/** A consultation asked for: its day and window, then the one visit and its code, or the first fit asked with it. */
function consultationAsked(detail: readonly string[]): Prefill {
  const [day, when, plan, code] = detail;
  const oneVisit = plan === "one_visit";
  return {
    choice: oneVisit ? "one_visit" : "consultation",
    ...(isDate(day) ? { date: day } : {}),
    ...(isWindow(when) ? { window: when } : {}),
    ...(oneVisit && code !== undefined ? { code } : {}),
  };
}

/** What the booking starts from, by the task's group and the one fact it holds; null for a group not done so. */
export function prefillOf(group: Group, detail: string | null): Prefill | null {
  const parts = detail?.split(" ") ?? [];
  if (group === "consultation_request") return consultationAsked(parts);
  if (group === "first_fit_to_book") {
    // The consultation's start, then the window the fit was asked for in.
    const fitIn = parts[1];
    return { choice: "first_fit", ...(isWindow(fitIn) ? { window: fitIn } : {}) };
  }
  if (group === "replacement_order") return { choice: "replacement" };
  return null;
}

export function BookFromTask({
  group,
  task,
  subject,
  onBooked,
}: {
  group: Group;
  task: Task;
  /** Who the task heads with, which the button names to a screen reader. */
  subject: string;
  /** The visit is booked: the task is done. */
  onBooked: () => void;
}) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const mayBook = useAccess().mayCall("POST /api/visits");
  const prefill = prefillOf(group, task.detail);
  const person = task.person;
  if (!mayBook || prefill === null || person === null) return null;
  return (
    <span className={styles.acts}>
      <button
        type="button"
        className={styles.act}
        ref={opener}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true);
        }}
      >
        {tasks.book}
        <VisuallyHidden>{` · ${subject}`}</VisuallyHidden>
      </button>
      {open && (
        <BookVisit
          clientId={person.id}
          name={person.name}
          prefill={prefill}
          onClose={(booked) => {
            setOpen(false);
            if (booked !== null && booked.outcome !== "awaiting_payment") onBooked();
            else requestAnimationFrame(() => opener.current?.focus());
          }}
        />
      )}
    </span>
  );
}
