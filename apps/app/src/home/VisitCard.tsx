// A visit still to come, on ink, as board B1 draws Home's next one: its date and window, its technician and
// length, where, and Reschedule and Add a note. Home shows the next; an upcoming visit's own page shows its own.
//
// While self-serve booking is on, Reschedule opens the move sheet (C7), from which the visit can be cancelled
// (C8). Until then, Reschedule and Add a note open WhatsApp to ops with a message ready
// (docs/prompts/phase2-backend.md, "Booking"). Offline, rescheduling waits for the connection (B3). Once the
// visit has begun, or its window has passed while FSM still has it open, nothing is left to move: its card says
// where it stands, and only a note can still be added.

import { shortDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import type { VisitSummary } from "../api.ts";
import { home, messages, windowText } from "../content.ts";
import { ChangeSheet, type ChangingVisit } from "../booking/ChangeSheet.tsx";
import { firstName, visitName } from "../lib/visit.ts";
import { whatsappWith } from "../lib/whatsapp.ts";
import { useSession } from "../session.ts";
import styles from "./home.module.css";

/** A visit from FSM the client may move or cancel in the app, while self-serve booking is on. */
export function changingOf(visit: VisitSummary, what: string): ChangingVisit | null {
  if (visit.type === null) return null;
  return {
    id: visit.id,
    type: visit.type,
    date: visit.date,
    message: messages.reschedule(what, shortDate(visit.date)),
  };
}

/** Under way or being closed: the visit has begun, and there is nothing left to move. */
export const hasBegun = (visit: VisitSummary) => visit.stage === "in_progress" || visit.stage === "closing";

/** The window, or where a visit that has begun stands. */
export function whenText(visit: VisitSummary): string {
  if (visit.stage === "in_progress" || visit.stage === "closing") return home.stages[visit.stage];
  return windowText(visit.window_label);
}

function Reschedule(props: { what: string; date: string; changing: ChangingVisit | null; onOpen: () => void }) {
  const { me, offline } = useSession();
  if (offline) {
    return (
      <button className={styles.action} type="button" disabled>
        {home.reschedule}
      </button>
    );
  }
  if (!me.booking.self_serve || props.changing === null) {
    return (
      <a className={styles.action} href={whatsappWith(messages.reschedule(props.what, props.date))} rel="noopener">
        {home.reschedule}
      </a>
    );
  }
  return (
    <button className={styles.action} type="button" onClick={props.onOpen}>
      {home.reschedule}
    </button>
  );
}

export function Actions(props: { what: string; date: string; changing: ChangingVisit | null; begun?: boolean }) {
  const { what, date, changing } = props;
  const { refresh } = useSession();
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.actions}>
      {props.begun !== true && (
        <Reschedule
          what={what}
          date={date}
          changing={changing}
          onOpen={() => {
            setOpen(true);
          }}
        />
      )}
      <a className={styles.action} href={whatsappWith(messages.note(what, date))} rel="noopener">
        {home.note}
      </a>
      {open && changing !== null && (
        <ChangeSheet
          visit={changing}
          start="move"
          onClose={(changed) => {
            setOpen(false);
            if (changed) refresh();
          }}
        />
      )}
    </div>
  );
}

/** Board B1's card: the visit, its technician, and what can still be done about it. */
export function VisitCard({ visit }: { visit: VisitSummary }) {
  const date = shortDate(visit.date);
  const what = visitName(visit.type);
  return (
    <div className={styles.card}>
      <p className={styles.date}>{date}</p>
      <p className={styles.window}>{whenText(visit)}</p>
      <div className={styles.technician}>
        {visit.technician !== null && (
          <span className={styles.initials} aria-hidden="true">
            {visit.technician.initials}
          </span>
        )}
        <div>
          {visit.technician !== null && <p className={styles.who}>{firstName(visit.technician.name)}</p>}
          <p className={styles.length}>{home.next.length(what, visit.length_minutes)}</p>
        </div>
      </div>
      {visit.place !== "" && <p className={styles.place}>{visit.place}</p>}
      <Actions what={what} date={date} changing={changingOf(visit, what)} begun={hasBegun(visit)} />
    </div>
  );
}
