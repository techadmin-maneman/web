// A task done by booking the client a visit: a consultation asked for, a first fit to book, a replacement due, and a
// first fit or replacement left partly done, booked again free (src/policy/tasks.ts). The row opens the panel the
// client's page books from, started from what the task holds; the task leaves the board once the visit is booked, and
// stays while a payment link for it waits to be paid.

import { TextButton } from "@maneman/ui/TextLink";
import { BookVisit, type Prefill } from "../clients/index.ts";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { useRef, useState } from "react";
import type { BookingWindow, Task } from "../api.ts";
import { tasks } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import styles from "./tasks.module.css";

const WINDOWS: readonly string[] = ["morning", "afternoon", "evening"];
const isWindow = (text: string | null): text is BookingWindow => text !== null && WINDOWS.includes(text);

/** A consultation asked for: its day and window, then the one visit and its code. */
function consultationAsked(facts: Extract<Task["facts"], { group: "consultation_request" }>): Prefill {
  return {
    choice: facts.one_visit ? "one_visit" : "consultation",
    date: facts.date,
    ...(isWindow(facts.window) ? { window: facts.window } : {}),
    ...(facts.one_visit && facts.discount_code !== null ? { code: facts.discount_code } : {}),
  };
}

/** What the booking starts from, by what the task turns on; null for a task not booked so. */
function prefillOf(task: Task): Prefill | null {
  const { facts } = task;
  if (facts.group === "consultation_request") return consultationAsked(facts);
  // The window the fit is offered in, the consultation's.
  if (facts.group === "first_fit_to_book") {
    return { choice: "first_fit", ...(isWindow(facts.fit_window) ? { window: facts.fit_window } : {}) };
  }
  if (facts.group === "replacement_order" || facts.group === "recall_call") return { choice: "replacement" };
  // A first fit or replacement left partly done is made good, free.
  if (facts.group === "partial_visit" && (facts.kind === "first_fit" || facts.kind === "replacement")) {
    return { choice: facts.kind, covers: task.id };
  }
  return null;
}

export function BookFromTask({
  task,
  subject,
  onBooked,
}: {
  task: Task;
  /** Who the task heads with, which the button names to a screen reader. */
  subject: string;
  /** The visit is booked: the task is done. */
  onBooked: () => void;
}) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const mayBook = useAccess().mayCall("POST /api/visits");
  const prefill = prefillOf(task);
  const person = task.person;
  if (!mayBook || prefill === null || person === null) return null;
  return (
    <span className={styles.acts}>
      <TextButton
        tone="muted"
        compact
        ref={opener}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true);
        }}
      >
        {prefill.covers === undefined ? tasks.book : tasks.bookFree}
        <VisuallyHidden>{` · ${subject}`}</VisuallyHidden>
      </TextButton>
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
