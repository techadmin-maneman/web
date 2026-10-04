// A visit still to come, on ink, as board B1 draws Home's next one: its date and window, its technician and
// length, where, and Reschedule and Add a note. Home shows the next; an upcoming visit's own page shows its own.
// A consultation and fit in one visit says what it costs once fitted, and how it is paid.
//
// While self-serve booking is on, Reschedule opens the move sheet (C7), from which the visit can be cancelled
// (C8), and Add a note keeps the note on the visit for the technician (NoteSheet.tsx). Until then, Reschedule and
// Add a note open WhatsApp to ops with a message ready
// (docs/prompts/phase2-backend.md, "Booking"). Offline, rescheduling waits for the connection (B3). Once the
// visit has begun, or its window has passed while it is still open, its card says where it stands, and offers
// nothing more.

import { Button, ButtonLink } from "@maneman/ui/Button";
import { shortDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import type { OneVisitPrice, VisitSummary } from "../api.ts";
import { home, messages, windowText } from "../content.ts";
import { ChangeSheet, type ChangingVisit } from "../booking/ChangeSheet.tsx";
import { NoteSheet } from "../booking/NoteSheet.tsx";
import { firstName, oneVisitOf, summaryName, visitTitle } from "../lib/visit.ts";
import { whatsappWith } from "../lib/whatsapp.ts";
import { useSession } from "../session.ts";
import { oneVisitLines } from "./one-visit-words.ts";
import styles from "./home.module.css";

/** A visit the client may move or cancel in the app, while self-serve booking is on. */
export function changingOf(visit: VisitSummary, what: string): ChangingVisit | null {
  if (visit.type === null) return null;
  return {
    id: visit.id,
    type: visit.type,
    date: visit.date,
    message: messages.reschedule(what, shortDate(visit.date)),
  };
}

/** A visit, which a note can be kept on, and its technician's first name. */
export const notingOf = (visit: VisitSummary): NotingVisit => ({
  visitId: visit.id,
  technician: visit.technician === null ? null : firstName(visit.technician.name),
});

/** Under way, done or being closed: the visit has begun, and there is nothing left to move or add. */
export const hasBegun = (visit: VisitSummary) => visit.stage !== null && visit.stage !== "booked";

/** Where a visit that has begun stands; null for one still to come. */
export function stageText(visit: VisitSummary): string | null {
  if (visit.stage === null || visit.stage === "booked") return null;
  return home.stages[visit.stage];
}

/** The window, or where a visit that has begun stands. */
export const whenText = (visit: VisitSummary): string => stageText(visit) ?? windowText(visit.window_label);

function Reschedule(props: { what: string; date: string; changing: ChangingVisit | null; onOpen: () => void }) {
  const { me, offline } = useSession();
  if (offline) {
    return (
      <Button variant="outlineOnInk" size="control" className={styles.action} disabled>
        {home.reschedule}
      </Button>
    );
  }
  if (!me.booking.self_serve || props.changing === null) {
    return (
      <ButtonLink
        variant="outlineOnInk"
        size="control"
        className={styles.action}
        href={whatsappWith(messages.reschedule(props.what, props.date))}
        rel="noopener"
      >
        {home.reschedule}
      </ButtonLink>
    );
  }
  return (
    <Button variant="outlineOnInk" size="control" className={styles.action} onClick={props.onOpen}>
      {home.reschedule}
    </Button>
  );
}

/** A visit a note can be kept on, and who reads it. */
export interface NotingVisit {
  readonly visitId: string;
  /** The technician's first name; null while none is assigned. */
  readonly technician: string | null;
}

function NoteOnWhatsApp({ message }: { message: string }) {
  return (
    <ButtonLink
      variant="outlineOnInk"
      size="control"
      className={styles.action}
      href={whatsappWith(message)}
      rel="noopener"
    >
      {home.note}
    </ButtonLink>
  );
}

/**
 * Add a note: kept on the visit for the technician's card while self-serve booking is on (REQ-04), else sent to ops
 * on WhatsApp. Tapped offline, it opens WhatsApp, which keeps the note until the phone is back online. A sheet
 * already open stays open when the connection drops, with what the client has written.
 */
function AddNote(props: { what: string; date: string; noting: NotingVisit | null }) {
  const { me, offline } = useSession();
  const [open, setOpen] = useState(false);
  const message = messages.note(props.what, props.date);
  const noting = me.booking.self_serve ? props.noting : null;
  if (noting === null) return <NoteOnWhatsApp message={message} />;
  return (
    <>
      {offline && !open ? (
        <NoteOnWhatsApp message={message} />
      ) : (
        <Button
          variant="outlineOnInk"
          size="control"
          className={styles.action}
          onClick={() => {
            setOpen(true);
          }}
        >
          {home.note}
        </Button>
      )}
      {open && (
        <NoteSheet
          visitId={noting.visitId}
          technician={noting.technician}
          message={message}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

export function Actions(props: {
  what: string;
  date: string;
  changing: ChangingVisit | null;
  noting: NotingVisit | null;
}) {
  const { what, date, changing } = props;
  const { refresh } = useSession();
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.actions}>
      <Reschedule
        what={what}
        date={date}
        changing={changing}
        onOpen={() => {
          setOpen(true);
        }}
      />
      <AddNote what={what} date={date} noting={props.noting} />
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

/** What a one visit costs once fitted, and how it is paid. */
export function OneVisitTerms({ price }: { price: OneVisitPrice }) {
  const [first, ...rest] = oneVisitLines(price);
  return (
    <div className={styles.terms}>
      <p>{first}</p>
      {rest.map((line) => (
        <p key={line} className={styles.termsMore}>
          {line}
        </p>
      ))}
    </div>
  );
}

/** Board B1's card: the visit, its technician, and what can still be done about it. */
export function VisitCard({ visit }: { visit: VisitSummary }) {
  const date = shortDate(visit.date);
  const what = summaryName(visit);
  const oneVisit = oneVisitOf(visit);
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
          <p className={styles.length}>
            {home.next.length(oneVisit === null ? visitTitle(visit) : what, visit.length_minutes)}
          </p>
        </div>
      </div>
      {visit.place !== "" && <p className={styles.place}>{visit.place}</p>}
      {oneVisit !== null && <OneVisitTerms price={oneVisit} />}
      {!hasBegun(visit) && (
        <Actions what={what} date={date} changing={changingOf(visit, what)} noting={notingOf(visit)} />
      )}
    </div>
  );
}
