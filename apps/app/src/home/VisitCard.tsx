// A visit still to come, on navy, as Home draws Home's next one (design/client-redesign, Home): its day and how far
// off, when, what and how long, where, its technician, and Change and Add a note. Home shows the next; an upcoming visit's own page shows its own.
// A consultation and fit in one visit says what it costs once fitted, and how it is paid.
//
// While self-serve booking is on, Reschedule opens the move sheet, from which the visit can be cancelled
// too, and Add a note keeps the note on the visit for the technician (NoteSheet.tsx). Until then, Reschedule and
// Add a note open WhatsApp to ops with a message ready
// (docs/prompts/phase2-backend.md, "Booking"). Offline, rescheduling waits for the connection. Once the
// visit has begun, or its window has passed while it is still open, its card says where it stands, and offers
// nothing more.

import { ChangeSheet, type ChangingVisit, NoteSheet } from "../booking/index.ts";
import { CLIENT_ICONS, GLYPHS } from "@maneman/brand/icons";
import { Button, ButtonLink } from "@maneman/ui/Button";
import { Icon } from "@maneman/ui/Icon";
import { apiNow } from "@maneman/web-kit/clock";
import { dayMonth, shortDate, todayInIndia, weekdayName } from "@maneman/web-kit/dates";
import { useState, type ReactNode } from "react";
import type { OneVisitPrice, VisitSummary } from "../api.ts";
import { arrivalHours, home, messages, note, visits } from "../content.ts";
import { rupees } from "@maneman/web-kit/money";
import { oneVisitOf, summaryName, visitTitle } from "../lib/visit.ts";
import { whatsappWith } from "../lib/whatsapp.ts";
import { useSession } from "../session.ts";
import { oneVisitLines } from "./one-visit-words.ts";
import { ProposedMove } from "./ProposedMove.tsx";
import styles from "./home.module.css";
import { firstNameOf } from "@rules/lib/names.ts";

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
  technician: visit.technician === null ? null : firstNameOf(visit.technician.name),
  note: visit.client_note,
});

/** Under way, done or being closed: the visit has begun, and there is nothing left to move or add. */
export const hasBegun = (visit: VisitSummary) => visit.stage !== null && visit.stage !== "booked";

/** Where a visit that has begun stands; null for one still to come. */
export function stageText(visit: VisitSummary): string | null {
  if (visit.stage === null || visit.stage === "booked") return null;
  return home.stages[visit.stage];
}

/** When the technician arrives, or where a visit that has begun stands. */
export const whenText = (visit: VisitSummary): string => stageText(visit) ?? arrivalHours(visit);

function Reschedule(props: {
  what: string;
  date: string;
  changing: ChangingVisit | null;
  /** "Pick another time" while a move is proposed; "Reschedule" otherwise. */
  label: string;
  onOpen: () => void;
}) {
  const { me, offline } = useSession();
  if (offline) {
    return (
      <Button variant="outlineOnInk" size="control" className={styles.action} disabled>
        {props.label}
      </Button>
    );
  }
  if (props.changing === null || !me.booking.self_serve_kinds.includes(props.changing.type)) {
    return (
      <ButtonLink
        variant="outlineOnInk"
        size="control"
        className={styles.action}
        href={whatsappWith(messages.reschedule(props.what, props.date))}
        rel="noopener"
      >
        {props.label}
      </ButtonLink>
    );
  }
  return (
    <Button variant="outlineOnInk" size="control" className={styles.action} onClick={props.onOpen}>
      {props.label}
    </Button>
  );
}

/** A visit a note can be kept on, and who reads it. */
export interface NotingVisit {
  readonly visitId: string;
  /** The technician's first name; null while none is assigned. */
  readonly technician: string | null;
  /** The note the client left on it already; null for none. */
  readonly note: string | null;
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
 * Add a note: kept on the visit for the technician's card while self-serve booking is on, else sent to ops
 * on WhatsApp. Tapped offline, it opens WhatsApp, which keeps the note until the phone is back online. A sheet
 * already open stays open when the connection drops, with what the client has written.
 */
function AddNote(props: { what: string; date: string; noting: NotingVisit | null; onNoted?: (note: string) => void }) {
  const { me, offline } = useSession();
  const [open, setOpen] = useState(false);
  const message = messages.note(props.what, props.date);
  const noting = me.booking.self_serve_kinds.length > 0 ? props.noting : null;
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
          initial={noting.note}
          message={message}
          onSaved={props.onNoted}
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
  onNoted?: (note: string) => void;
  /** A move to another day is proposed, so Reschedule offers another time instead. */
  proposed?: boolean;
  /** The visit was moved or cancelled, for a page that shows it to read it again. */
  onChanged?: (change: "moved" | "cancelled") => void;
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
        label={props.proposed === true ? home.proposal.pick : home.reschedule}
        onOpen={() => {
          setOpen(true);
        }}
      />
      <AddNote what={what} date={date} noting={props.noting} onNoted={props.onNoted} />
      {open && changing !== null && (
        <ChangeSheet
          visit={changing}
          start="move"
          onClose={(change) => {
            setOpen(false);
            if (change === null) return;
            refresh();
            props.onChanged?.(change);
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

/** Days from today in India to the visit's day: 0 on the day. */
function daysAway(date: string): number {
  return Math.round((Date.parse(date) - Date.parse(todayInIndia(apiNow()))) / 86_400_000);
}

/** One line of the card's facts, with its icon. */
export function Fact({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <li className={styles.fact}>
      <Icon className={styles.factIcon} d={icon} size="sm" />
      <span>{children}</span>
    </li>
  );
}

/** Who is coming, under a rule. */
export function Technician({ technician }: { technician: NonNullable<VisitSummary["technician"]> }) {
  return (
    <div className={styles.technician}>
      <span className={styles.initials} aria-hidden="true">
        {technician.initials}
      </span>
      <div>
        <p className={styles.who}>{firstNameOf(technician.name)}</p>
        <p className={styles.length}>{home.technicianFor}</p>
      </div>
    </div>
  );
}

/**
 * Home's card on navy: what the visit is, its day and how far off, when the technician comes, what it is and how long,
 * where, what it costs, who is coming, and what can still be done about it. `label` names it, as Home heads its card.
 */
export function VisitCard({
  visit,
  label,
  onChanged,
}: {
  visit: VisitSummary;
  label?: { readonly id: string; readonly text: string };
  onChanged?: (change: "moved" | "cancelled") => void;
}) {
  const date = shortDate(visit.date);
  const what = summaryName(visit);
  const oneVisit = oneVisitOf(visit);
  const begun = hasBegun(visit);
  // A note just saved, shown before the visit is read again.
  const [noted, setNoted] = useState<string | null>(null);
  const clientNote = noted ?? visit.client_note;
  return (
    <div className={styles.card}>
      {label !== undefined && (
        <h2 className={styles.eyebrow} id={label.id}>
          {label.text}
        </h2>
      )}
      <p className={styles.date}>{`${weekdayName(visit.date)} ${dayMonth(visit.date)}`}</p>
      {!begun && <p className={styles.away}>{home.away(daysAway(visit.date))}</p>}
      <ul className={styles.facts}>
        <Fact icon={GLYPHS.clock}>{whenText(visit)}</Fact>
        <Fact icon={CLIENT_ICONS.layers}>
          {home.next.length(oneVisit === null ? visitTitle(visit) : what, visit.length_minutes)}
        </Fact>
        {visit.place !== "" && <Fact icon={GLYPHS.pin}>{visit.place}</Fact>}
        {visit.pay_at_visit !== null && (
          <Fact icon={CLIENT_ICONS.receipt}>{visits.payAtVisit(rupees(visit.pay_at_visit))}</Fact>
        )}
      </ul>
      {oneVisit !== null && <OneVisitTerms price={oneVisit} />}
      {clientNote !== null && <p className={styles.place}>{note.shown(clientNote)}</p>}
      {visit.technician !== null && <Technician technician={visit.technician} />}
      {!begun && visit.proposed_move !== null && <ProposedMove visitId={visit.id} proposal={visit.proposed_move} />}
      {!begun && (
        <Actions
          what={what}
          date={date}
          changing={changingOf(visit, what)}
          noting={{ ...notingOf(visit), note: clientNote }}
          onNoted={setNoted}
          proposed={visit.proposed_move !== null}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}
